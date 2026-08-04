#!/usr/bin/env python3
"""Safely update, publish, deploy, and verify the complete site resource cycle."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from resource_lib import PROJECT_ROOT, atomic_write_json


DEFAULT_CONFIG = PROJECT_ROOT / "site-maintenance.json"
DEFAULT_REPORT = PROJECT_ROOT / "artifacts/site-maintenance-report.json"
LOCK_PATH = PROJECT_ROOT / "artifacts/site-maintenance.lock"
GITHUB_REPO_RE = re.compile(
    r"(?:github\.com[/:])(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$",
    re.IGNORECASE,
)


class MaintenanceError(RuntimeError):
    """Expected, user-actionable maintenance failure."""


@dataclass
class CommandResult:
    command: list[str]
    returncode: int
    output: str


class CommandRunner:
    def run(
        self,
        command: list[str],
        *,
        check: bool = True,
        quiet: bool = False,
        env: dict[str, str] | None = None,
    ) -> CommandResult:
        printable = " ".join(command)
        if not quiet:
            print(f"\n> {printable}", flush=True)
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        process = subprocess.Popen(
            command,
            cwd=PROJECT_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=merged_env,
        )
        lines: list[str] = []
        assert process.stdout is not None
        for line in process.stdout:
            lines.append(line)
            if not quiet:
                print(line, end="", flush=True)
        returncode = process.wait()
        result = CommandResult(command, returncode, "".join(lines))
        if check and returncode:
            detail = result.output.strip().splitlines()
            summary = detail[-1] if detail else f"código {returncode}"
            raise MaintenanceError(f"Falló `{printable}`: {summary}")
        return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Run dependencies and resource maintenance without Git pull, publication, or deployment verification",
    )
    parser.add_argument("--plan", action="store_true", help="Stop after the read-only resource plan")
    parser.add_argument("--skip-deployment", action="store_true", help="Do not verify the deployed site")
    return parser.parse_args()


def load_config(path: Path) -> dict[str, Any]:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MaintenanceError(f"No se pudo leer {path}: {exc}") from exc
    required = {
        "officialRepository",
        "baseBranch",
        "productionUrl",
        "automationBranchPrefix",
        "allowedChangePaths",
    }
    missing = sorted(required - set(config))
    if missing:
        raise MaintenanceError(f"Configuración incompleta; faltan: {', '.join(missing)}")
    if not isinstance(config["allowedChangePaths"], list) or not config["allowedChangePaths"]:
        raise MaintenanceError("allowedChangePaths debe contener al menos una ruta")
    return config


def repository_from_url(url: str) -> str | None:
    match = GITHUB_REPO_RE.search(url.strip())
    if not match:
        return None
    return f"{match.group('owner')}/{match.group('repo')}".lower()


def path_is_allowed(path: str, allowed: list[str]) -> bool:
    normalized = path.replace("\\", "/").lstrip("./")
    for entry in allowed:
        candidate = str(entry).replace("\\", "/").lstrip("./")
        if candidate.endswith("/") and normalized.startswith(candidate):
            return True
        if normalized == candidate:
            return True
    return False


def _git_lines(runner: CommandRunner, *args: str) -> list[str]:
    result = runner.run(["git", *args], quiet=True)
    return [line.strip() for line in result.output.splitlines() if line.strip()]


def changed_paths(runner: CommandRunner) -> set[str]:
    paths = set(_git_lines(runner, "diff", "--name-only"))
    paths.update(_git_lines(runner, "diff", "--cached", "--name-only"))
    paths.update(_git_lines(runner, "ls-files", "--others", "--exclude-standard"))
    return paths


def tracked_worktree_is_clean(runner: CommandRunner) -> bool:
    unstaged = runner.run(["git", "diff", "--quiet"], check=False, quiet=True).returncode
    staged = runner.run(["git", "diff", "--cached", "--quiet"], check=False, quiet=True).returncode
    return unstaged == 0 and staged == 0


def discover_official_remote(runner: CommandRunner, official_repository: str) -> str:
    target = official_repository.lower()
    for remote in _git_lines(runner, "remote"):
        url = runner.run(["git", "remote", "get-url", remote], quiet=True).output.strip()
        if repository_from_url(url) == target:
            return remote
    remote = "official"
    existing = set(_git_lines(runner, "remote"))
    if remote in existing:
        raise MaintenanceError(
            f"El remoto `{remote}` existe pero no apunta a {official_repository}; debe revisarlo un administrador"
        )
    runner.run(["git", "remote", "add", remote, f"https://github.com/{official_repository}.git"])
    return remote


def ensure_prerequisites(runner: CommandRunner, *, require_github: bool) -> dict[str, str]:
    required = ["git", "npm"] + (["gh"] if require_github else [])
    missing = [name for name in required if shutil.which(name) is None]
    if missing:
        raise MaintenanceError(f"Faltan herramientas del sistema: {', '.join(missing)}")
    versions = {
        name: runner.run([name, "--version"], quiet=True).output.strip().splitlines()[0]
        for name in required
    }
    if require_github:
        auth = runner.run(["gh", "auth", "status", "-h", "github.com"], check=False, quiet=True)
        if auth.returncode:
            raise MaintenanceError(
                "GitHub no está autenticado. Cierre esta ventana, vuelva a abrir el acceso directo "
                "y complete el inicio de sesión que aparecerá en el navegador."
            )
    return versions


def ensure_repository_ready(
    runner: CommandRunner,
    config: dict[str, Any],
) -> tuple[str, list[str]]:
    root = Path(runner.run(["git", "rev-parse", "--show-toplevel"], quiet=True).output.strip()).resolve()
    if root != PROJECT_ROOT.resolve():
        raise MaintenanceError(f"El lanzador no está trabajando en la raíz esperada: {root}")
    branch = runner.run(["git", "branch", "--show-current"], quiet=True).output.strip()
    base_branch = str(config["baseBranch"])
    if branch != base_branch:
        raise MaintenanceError(
            f"La copia local está en la rama `{branch}`, pero el actualizador integral sólo opera desde `{base_branch}`."
        )
    if not tracked_worktree_is_clean(runner):
        raise MaintenanceError(
            "Hay cambios locales en archivos versionados. No se tocó nada; un administrador debe revisarlos."
        )

    existing_untracked = _git_lines(runner, "ls-files", "--others", "--exclude-standard")
    unsafe_untracked = [
        path for path in existing_untracked if path_is_allowed(path, config["allowedChangePaths"])
    ]
    if unsafe_untracked:
        raise MaintenanceError(
            "Hay archivos sin versionar dentro de rutas publicables: " + ", ".join(sorted(unsafe_untracked))
        )

    remote = discover_official_remote(runner, str(config["officialRepository"]))
    runner.run(["git", "fetch", remote, base_branch])
    counts = runner.run(
        ["git", "rev-list", "--left-right", "--count", f"HEAD...{remote}/{base_branch}"],
        quiet=True,
    ).output.strip().split()
    if len(counts) != 2:
        raise MaintenanceError("Git no pudo comparar la copia local con producción")
    local_only, remote_only = (int(value) for value in counts)
    if local_only:
        raise MaintenanceError(
            f"La rama local contiene {local_only} commit(s) no publicados. No se intentó mezclar ni sobrescribirlos."
        )
    if remote_only:
        runner.run(["git", "merge", "--ff-only", f"{remote}/{base_branch}"])
    return remote, existing_untracked


def read_json_report(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MaintenanceError(f"Informe inexistente o inválido {path}: {exc}") from exc


def run_resource_cycle(
    runner: CommandRunner,
    report_dir: Path,
    *,
    plan_only: bool,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    runner.run(["npm", "ci"])
    plan_path = report_dir / "resource-plan.json"
    runner.run(["npm", "run", "resources:plan", "--", "--report", str(plan_path), "--no-install"])
    plan = read_json_report(plan_path)
    if plan.get("errors"):
        raise MaintenanceError("La planificación de recursos informó errores")
    if plan_only:
        return plan, None

    sync_path = report_dir / "resource-sync.json"
    runner.run(["npm", "run", "resources:sync", "--", "--report", str(sync_path), "--no-install"])
    sync = read_json_report(sync_path)
    if sync.get("errors"):
        raise MaintenanceError("La actualización integral informó errores")
    return plan, sync


def github_identity(runner: CommandRunner) -> dict[str, Any]:
    result = runner.run(["gh", "api", "user"], quiet=True)
    try:
        payload = json.loads(result.output)
    except json.JSONDecodeError as exc:
        raise MaintenanceError("GitHub no devolvió una identidad válida") from exc
    if not payload.get("login"):
        raise MaintenanceError("GitHub no informó el nombre de la cuenta autenticada")
    return payload


def discover_publish_remote(
    runner: CommandRunner,
    official_remote: str,
    official_repository: str,
    login: str,
) -> tuple[str, str]:
    permission_result = runner.run(
        ["gh", "repo", "view", official_repository, "--json", "viewerPermission"],
        quiet=True,
    )
    permission = json.loads(permission_result.output).get("viewerPermission")
    if permission in {"ADMIN", "MAINTAIN", "WRITE"}:
        return official_remote, official_repository

    for remote in _git_lines(runner, "remote"):
        url = runner.run(["git", "remote", "get-url", remote], quiet=True).output.strip()
        repository = repository_from_url(url)
        if repository and repository.split("/", 1)[0].lower() == login.lower():
            return remote, repository
    raise MaintenanceError(
        f"La cuenta {login} no puede escribir en {official_repository} y no se encontró un fork publicable."
    )


def configure_git_identity(runner: CommandRunner, identity: dict[str, Any]) -> None:
    name = runner.run(["git", "config", "--get", "user.name"], check=False, quiet=True).output.strip()
    email = runner.run(["git", "config", "--get", "user.email"], check=False, quiet=True).output.strip()
    login = str(identity["login"])
    if not name:
        runner.run(["git", "config", "user.name", identity.get("name") or login])
    if not email:
        runner.run(["git", "config", "user.email", f"{login}@users.noreply.github.com"])


def create_pull_request(
    runner: CommandRunner,
    config: dict[str, Any],
    official_remote: str,
    changed: list[str],
    tasks: list[dict[str, Any]],
) -> tuple[str, str, bool]:
    identity = github_identity(runner)
    configure_git_identity(runner, identity)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    branch = f"{config['automationBranchPrefix']}-{timestamp}"
    runner.run(["git", "switch", "-c", branch])
    allowed = [str(path) for path in config["allowedChangePaths"]]
    runner.run(["git", "add", "--", *allowed])
    if runner.run(["git", "diff", "--cached", "--quiet"], check=False, quiet=True).returncode == 0:
        raise MaintenanceError("Git no encontró cambios publicables después de la actualización")
    runner.run(["git", "commit", "-m", str(config.get("commitMessage", "chore: actualización automática"))])

    publish_remote, publish_repository = discover_publish_remote(
        runner,
        official_remote,
        str(config["officialRepository"]),
        str(identity["login"]),
    )
    runner.run(["git", "push", "-u", publish_remote, branch])
    head = branch
    if publish_repository.lower() != str(config["officialRepository"]).lower():
        head = f"{publish_repository.split('/', 1)[0]}:{branch}"

    body_lines = [
        "Actualización integral generada por el lanzador automático del sitio.",
        "",
        f"- {len(changed)} archivo(s) modificados.",
        "- Fuentes, checksums, catálogo y estructura física validados.",
        "- Pruebas, build y auditoría de rutas completados.",
    ]
    draft = bool(tasks)
    if tasks:
        body_lines.extend(
            [
                f"- Quedan {len(tasks)} tarea(s) asistida(s); el PR se deja como borrador.",
                "- Un agente compatible debe completar esas tareas antes de publicar.",
            ]
        )
    command = [
        "gh",
        "pr",
        "create",
        "--repo",
        str(config["officialRepository"]),
        "--base",
        str(config["baseBranch"]),
        "--head",
        head,
        "--title",
        str(config.get("pullRequest", {}).get("title", config["commitMessage"])),
        "--body",
        "\n".join(body_lines),
    ]
    if draft:
        command.append("--draft")
    output = runner.run(command).output
    urls = re.findall(r"https://github\.com/[^\s]+/pull/\d+", output)
    if not urls:
        raise MaintenanceError("GitHub creó la rama pero no devolvió la URL del PR")
    return urls[-1], branch, draft


def wait_for_pr_checks(runner: CommandRunner, config: dict[str, Any], pr_url: str) -> None:
    settings = config.get("pullRequest", {})
    discovery = int(settings.get("checkDiscoverySeconds", 45))
    timeout = int(settings.get("checkTimeoutSeconds", 1800))
    poll = max(5, int(settings.get("pollSeconds", 15)))
    started = time.monotonic()
    checks_seen = False
    print("\nEsperando las comprobaciones del PR...", flush=True)
    while time.monotonic() - started < timeout:
        result = runner.run(
            [
                "gh",
                "pr",
                "checks",
                pr_url,
                "--repo",
                str(config["officialRepository"]),
                "--json",
                "bucket,name,state",
            ],
            check=False,
            quiet=True,
        )
        try:
            checks = json.loads(result.output) if result.output.strip() else []
        except json.JSONDecodeError:
            checks = []
        if checks:
            checks_seen = True
            failed = [item for item in checks if item.get("bucket") in {"fail", "cancel"}]
            pending = [item for item in checks if item.get("bucket") in {"pending"}]
            if failed:
                names = ", ".join(str(item.get("name")) for item in failed)
                raise MaintenanceError(f"Fallaron las comprobaciones del PR: {names}")
            if not pending:
                return
        elif time.monotonic() - started >= discovery:
            print("No hay comprobaciones remotas obligatorias; se usarán las validaciones locales.", flush=True)
            return
        time.sleep(poll)
    qualifier = "detectadas" if checks_seen else "esperadas"
    raise MaintenanceError(f"Se agotó el tiempo esperando las comprobaciones {qualifier} del PR")


def merge_pull_request(runner: CommandRunner, config: dict[str, Any], pr_url: str) -> None:
    head_sha = runner.run(["git", "rev-parse", "HEAD"], quiet=True).output.strip()
    runner.run(
        [
            "gh",
            "pr",
            "merge",
            pr_url,
            "--repo",
            str(config["officialRepository"]),
            "--squash",
            "--delete-branch",
            "--match-head-commit",
            head_sha,
        ]
    )
    settings = config.get("pullRequest", {})
    timeout = int(settings.get("checkTimeoutSeconds", 1800))
    poll = max(5, int(settings.get("pollSeconds", 15)))
    started = time.monotonic()
    print("\nEsperando que GitHub complete la fusión...", flush=True)
    while time.monotonic() - started < timeout:
        result = runner.run(
            [
                "gh",
                "pr",
                "view",
                pr_url,
                "--repo",
                str(config["officialRepository"]),
                "--json",
                "state,mergedAt,mergeStateStatus",
            ],
            quiet=True,
        )
        payload = json.loads(result.output)
        if payload.get("state") == "MERGED" or payload.get("mergedAt"):
            return
        if payload.get("state") == "CLOSED":
            raise MaintenanceError("El PR se cerró sin fusionarse")
        time.sleep(poll)
    raise MaintenanceError(
        "GitHub no completó la fusión dentro del tiempo esperado. Revise las reglas de rama y AUTOMATION_GITHUB_TOKEN."
    )


def return_to_production(
    runner: CommandRunner,
    config: dict[str, Any],
    official_remote: str,
) -> None:
    base = str(config["baseBranch"])
    runner.run(["git", "switch", base])
    runner.run(["git", "fetch", official_remote, base])
    runner.run(["git", "merge", "--ff-only", f"{official_remote}/{base}"])


def verify_deployment(runner: CommandRunner, config: dict[str, Any]) -> None:
    settings = config.get("deployment", {})
    runner.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "scripts/verify_deployment.py"),
            "--base-url",
            str(config["productionUrl"]),
            "--attempts",
            str(settings.get("attempts", 45)),
            "--interval",
            str(settings.get("intervalSeconds", 20)),
            "--timeout",
            str(settings.get("timeoutSeconds", 20)),
            "--workers",
            str(settings.get("workers", 8)),
        ]
    )


def acquire_lock() -> None:
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    if LOCK_PATH.exists():
        try:
            payload = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
            pid = int(payload.get("pid", 0))
            if pid:
                os.kill(pid, 0)
                raise MaintenanceError("Ya hay una actualización del sitio en ejecución")
        except ProcessLookupError:
            LOCK_PATH.unlink(missing_ok=True)
        except (OSError, ValueError, json.JSONDecodeError):
            if time.time() - LOCK_PATH.stat().st_mtime < 6 * 60 * 60:
                raise MaintenanceError("Existe un bloqueo reciente de otra actualización")
            LOCK_PATH.unlink(missing_ok=True)
    LOCK_PATH.write_text(
        json.dumps({"pid": os.getpid(), "createdAt": datetime.now(timezone.utc).isoformat()}),
        encoding="utf-8",
    )


def print_summary(report: dict[str, Any]) -> None:
    print("\n" + "=" * 72)
    print(report.get("message", "Actualización finalizada"))
    if report.get("prUrl"):
        print(f"PR: {report['prUrl']}")
    print(f"Informe: {report['reportPath']}")
    print("=" * 72 + "\n")


def main() -> int:
    args = parse_args()
    report_path = args.report.resolve()
    report_dir = report_path.parent
    report_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "status": "running",
        "mode": "local-only" if args.local_only else "publish",
        "steps": [],
        "warnings": [],
        "errors": [],
        "reportPath": str(report_path),
    }
    runner = CommandRunner()
    exit_code = 0
    locked = False
    try:
        config = load_config(args.config.resolve())
        acquire_lock()
        locked = True
        report["tools"] = ensure_prerequisites(runner, require_github=not args.local_only)
        report["steps"].append("doctor")

        official_remote: str | None = None
        before_paths = changed_paths(runner)
        if not args.local_only:
            official_remote, existing_untracked = ensure_repository_ready(runner, config)
            report["officialRemote"] = official_remote
            report["warnings"].extend(
                f"Archivo sin versionar preservado y excluido: {path}" for path in existing_untracked
            )
            report["steps"].append("fast-forward")

        plan, sync = run_resource_cycle(runner, report_dir, plan_only=args.plan)
        report["planChanged"] = bool(plan.get("changed"))
        report["steps"].extend(["dependencies", "resource-plan"])
        if args.plan:
            report["status"] = "success"
            report["message"] = "Planificación completada; no se aplicaron recursos ni se publicó nada."
        else:
            assert sync is not None
            report["steps"].append("resource-sync")
            tasks = list(sync.get("tasks", []))
            after_paths = changed_paths(runner)
            new_changes = sorted(after_paths - before_paths)
            unexpected = [
                path for path in new_changes if not path_is_allowed(path, config["allowedChangePaths"])
            ]
            if unexpected:
                raise MaintenanceError(
                    "La actualización intentó modificar rutas no autorizadas: " + ", ".join(unexpected)
                )
            report["changedPaths"] = new_changes
            report["tasks"] = tasks

            if args.local_only:
                report["status"] = "requires-review" if tasks else "success"
                report["message"] = (
                    "Actualización local completada; hay tareas asistidas pendientes."
                    if tasks
                    else "Actualización local completada y validada."
                )
            elif not new_changes:
                if tasks:
                    raise MaintenanceError(
                        f"Hay {len(tasks)} tarea(s) asistida(s) sin cambios publicables; debe intervenir un agente."
                    )
                if not args.skip_deployment:
                    verify_deployment(runner, config)
                    report["steps"].append("deployment-verify")
                report["status"] = "success"
                report["message"] = "El repositorio local y el sitio publicado ya estaban completamente actualizados."
            else:
                assert official_remote is not None
                pr_url, branch, draft = create_pull_request(
                    runner,
                    config,
                    official_remote,
                    new_changes,
                    tasks,
                )
                report.update({"prUrl": pr_url, "branch": branch})
                report["steps"].append("pull-request")
                if draft:
                    return_to_production(runner, config, official_remote)
                    report["status"] = "requires-review"
                    report["message"] = (
                        "Los cambios deterministas quedaron en un PR borrador; un agente debe completar las tareas asistidas."
                    )
                else:
                    wait_for_pr_checks(runner, config, pr_url)
                    report["steps"].append("pr-checks")
                    merge_pull_request(runner, config, pr_url)
                    report["steps"].append("merge")
                    return_to_production(runner, config, official_remote)
                    report["steps"].append("local-fast-forward")
                    if not args.skip_deployment:
                        verify_deployment(runner, config)
                        report["steps"].append("deployment-verify")
                    report["status"] = "success"
                    report["message"] = "Actualización publicada, desplegada, verificada y sincronizada localmente."
    except (MaintenanceError, OSError, ValueError, json.JSONDecodeError) as exc:
        exit_code = 1
        report["status"] = "blocked"
        report["errors"].append(str(exc))
        report["message"] = f"La actualización se detuvo de forma segura: {exc}"
    except KeyboardInterrupt:
        exit_code = 130
        report["status"] = "cancelled"
        report["errors"].append("Ejecución cancelada por la persona usuaria")
        report["message"] = "La actualización fue cancelada."
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        atomic_write_json(report_path, report)
        if locked:
            LOCK_PATH.unlink(missing_ok=True)
        print_summary(report)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
