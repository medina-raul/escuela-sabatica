import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import { adventechLessonUrls, ingestItem, isPublicAddress, prepareArticle, validateAsset, validateImportUrl } from "../lib/ingest.mjs";
import { createImportDownloader } from "../lib/ingest-remote.mjs";

function testDownloader(resultByPath, answers = [{ address: "93.184.216.34", family: 4 }]) {
  const requests = [];
  const download = createImportDownloader({
    resolveAddress: async () => answers,
    openRequest(url, options, callback) {
      requests.push(url.href);
      assert.equal(options.servername, url.hostname);
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.agent, false);
      options.lookup(url.hostname, {}, (error, address, family) => {
        assert.ifError(error);
        assert.deepEqual({ address, family }, answers[0]);
      });
      const entry = resultByPath.get(url.pathname);
      assert.ok(entry, "The simulated URL should be in the fixture");
      const request = new EventEmitter();
      request.end = () => {
        const response = Readable.from(entry.bytes ? [entry.bytes] : []);
        response.statusCode = entry.statusCode ?? 200;
        response.headers = entry.headers ?? {};
        callback(response);
      };
      return request;
    },
  });
  return { download, requests };
}

test("un HTML local conserva lo que lee el editor y segmenta lección, días y referencias", async () => {
  const original = Buffer.from('<html><head><title>Fuente</title></head><body><nav>Menú</nav><main>' +
    '<h1>Lección 4 · Estudio</h1><h2>Sábado 2027-01-02 · Lectura</h2>' +
    '<p>Estudia <b>Génesis 1:1</b> &amp; Juan 3:16.</p><aside>Menú lateral</aside>' +
    '<script>texto ajeno</script><p onclick="ruido()" hidden>Oculto</p>' +
    '<h2>Domingo 3 de enero de 2027</h2><blockquote>Salmos 23:1</blockquote></main></body></html>');
  let saved;
  const result = await ingestItem({ name: "folleto.html", bytes: original }, {
    onOriginal: item => { saved = item; },
  });
  assert.equal(result.kind, "html");
  assert.deepEqual(saved.bytes, original);
  assert.equal(saved.sha256, result.sha256);
  assert.equal(result.fragments.length, 2);
  const [saturday, sunday] = result.fragments;
  assert.equal(saturday.suggestedLessonNumber, 4);
  assert.equal(saturday.suggestedDayId, "sabado");
  assert.equal(saturday.suggestedDate, "2027-01-02");
  assert.equal(saturday.text, "Estudia Génesis 1:1 & Juan 3:16.");
  assert.deepEqual(saturday.referenceSuggestions, ["Génesis 1:1", "Juan 3:16"]);
  assert.equal(sunday.suggestedDayId, "domingo");
  assert.equal(sunday.suggestedDate, "2027-01-03");
  assert.equal(sunday.text, "> Salmos 23:1");
});

test("Markdown de archivo lee metadatos y detecta un versículo clave con referencia", async () => {
  const result = await ingestItem({
    name: "lectura.md",
    text: [
      "---", "title: Nuestro estudio", "date: 02/01/2027", "lesson: 1", "day: sábado", "---",
      "## Versículo clave", "", '> "En el principio creó Dios" (Génesis 1:1).', "",
      "Lee Juan 3:16 y Génesis 1:1.",
    ].join("\n"),
  });
  const [fragment] = result.fragments;
  assert.equal(result.kind, "markdown");
  assert.equal(fragment.title, "Nuestro estudio");
  assert.equal(fragment.suggestedLessonNumber, 1);
  assert.equal(fragment.suggestedDayId, "sabado");
  assert.equal(fragment.suggestedDate, "2027-01-02");
  assert.deepEqual(fragment.suggestedKeyVerse, { text: "En el principio creó Dios", reference: "Génesis 1:1" });
  assert.deepEqual(fragment.referenceSuggestions, ["Génesis 1:1", "Juan 3:16"]);
});

test("normaliza URL autorizada y valida que la conexión y redirecciones usen un destino permitido", async () => {
  const examples = new Map([
    ["/inicio", { statusCode: 302, headers: { location: "/estudio.html" } }],
    ["/estudio.html", { bytes: Buffer.from("<main><p>Repasa Lucas 2:11.</p></main>"),
      headers: { "content-type": "text/html; charset=utf-8" } }],
  ]);
  const spy = testDownloader(examples);
  const policy = { allowedHosts: ["estudio.example"], downloadSource: spy.download };
  const result = await ingestItem({ url: "https://estudio.example/inicio#lector", kind: "url" }, policy);
  assert.deepEqual(spy.requests, ["https://estudio.example/inicio", "https://estudio.example/estudio.html"]);
  assert.equal(result.originUrl, "https://estudio.example/estudio.html");
  assert.deepEqual(result.fragments[0].referenceSuggestions, ["Lucas 2:11"]);

  const forbiddenRedirect = testDownloader(new Map([
    ["/inicio", { statusCode: 302, headers: { location: "https://otro.example/no" } }],
  ]));
  await assert.rejects(() => forbiddenRedirect.download("https://estudio.example/inicio", {
    allowedHosts: policy.allowedHosts, maxBytes: 100,
  }), /Fuente no autorizada/);
  assert.equal(forbiddenRedirect.requests.length, 1);

  const privateDns = testDownloader(new Map(), [{ address: "::1", family: 6 }]);
  await assert.rejects(() => privateDns.download("https://estudio.example/inicio", {
    allowedHosts: policy.allowedHosts, maxBytes: 100,
  }), /direcciones públicas/);
  assert.deepEqual(privateDns.requests, []);
});

test("la descarga acotada diferencia material aún ausente de un archivo demasiado grande", async () => {
  const { download } = testDownloader(new Map([
    ["/faltante", { statusCode: 404, headers: { etag: "x" } }],
    ["/grande", { bytes: Buffer.alloc(1024) }],
  ]));
  const options = { allowedHosts: ["estudio.example"], maxBytes: 512, allowMissing: true };
  const missing = await download("https://estudio.example/faltante", options);
  assert.equal(missing.missing, true);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.etag, "x");
  await assert.rejects(() => download("https://estudio.example/grande", options), /supera el tamaño máximo/);
});

test("URLs e IP no habilitan destinos sin autorización", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1", "::ffff:169.254.169.254", "2001:db8::1"]) {
    assert.equal(isPublicAddress(address), false);
  }
  assert.equal(isPublicAddress("2606:4700::1111"), true);
  assert.throws(() => validateImportUrl("https://estudio.example"), /no autorizada/);
  for (const url of ["http://estudio.example", "https://editor@estudio.example", "https://estudio.example:8443"]) {
    assert.throws(() => validateImportUrl(url, ["estudio.example"]), /HTTPS sin credenciales/);
  }
});

test("Adventech genera siete documentos oficiales y ubica el día a partir de la ruta", async () => {
  const links = adventechLessonUrls({ year: 2027, quarterNumber: 1, lessonNumber: 5 });
  assert.equal(links.length, 7);
  assert.ok(links[0].endsWith("/2027-01/05/01.md"));
  const url = new URL(links[3]);
  const { download } = testDownloader(new Map([
    [url.pathname, { bytes: Buffer.from("---\ntitle: Esperanza\ndate: 02/02/2027\n---\nNuestra lectura es Romanos 8:28."),
      headers: { "content-type": "text/plain" } }],
  ]));
  const result = await ingestItem({ url: url.href, kind: "adventech" }, {
    allowedHosts: ["raw.githubusercontent.com"], downloadSource: download,
  });
  const [fragment] = result.fragments;
  assert.equal(fragment.title, "Esperanza");
  assert.equal(fragment.suggestedLessonNumber, 5);
  assert.equal(fragment.suggestedDayId, "martes");
  assert.equal(fragment.suggestedDate, "2027-02-02");
});

test("artículos se generan como HTML de lectura inerte y los activos se clasifican por firma", () => {
  const article = prepareArticle('### Estudio\n<script>alert(1)</script>\n> Génesis 1:1', "../Lectura.md");
  assert.equal(article.name, "Lectura.html");
  assert.match(article.bytes.toString(), /<blockquote>Génesis 1:1<\/blockquote>/);
  assert.doesNotMatch(article.bytes.toString(), /<script>/);
  assert.throws(() => validateAsset("Lectura.html", article.bytes), /pasan por la importación/);
  assert.throws(() => validateAsset("Audio.mp3", Buffer.from("esto es texto")), /MP3 admitido/);
  const mp3 = Buffer.alloc(10_000);
  Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(mp3);
  assert.equal(validateAsset("Archivo.mp3", mp3).kind, "audio");
});

function digitalPdf() {
  const stream = "BT /F1 22 Tf 60 750 Td (Sabado 2027-01-02) Tj 0 -50 Td (Estudia Juan 3:16.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, content] of objects.entries()) {
    offsets.push(source.length);
    source += (index + 1) + " 0 obj\n" + content + "\nendobj\n";
  }
  const table = source.length;
  source += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets) source += String(offset).padStart(10, "0") + " 00000 n \n";
  return Buffer.from(source + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + table + "\n%%EOF\n");
}

test("un PDF digital local conserva página, fecha, referencia y original", { skip: process.platform !== "darwin", timeout: 65_000 }, async () => {
  const bytes = digitalPdf();
  let saved;
  const result = await ingestItem({ name: "Lección 01.pdf", bytes }, { onOriginal: item => { saved = item; } });
  assert.equal(result.kind, "pdf");
  assert.equal(validateAsset("Lección 01.pdf", bytes).kind, "pdf");
  assert.equal(saved.sha256, result.sha256);
  assert.deepEqual(saved.bytes, bytes);
  const [fragment] = result.fragments;
  assert.ok(fragment, result.warnings.join("; "));
  assert.match(fragment.location, /^Página 1/);
  assert.equal(fragment.suggestedDayId, "sabado");
  assert.equal(fragment.suggestedLessonNumber, 1);
  assert.equal(fragment.suggestedDate, "2027-01-02");
  assert.deepEqual(fragment.referenceSuggestions, ["Juan 3:16"]);
});

test("OCR de dos páginas sin capa de texto propone días y citas para cotejo", { skip: process.platform !== "darwin", timeout: 120_000 }, async () => {
  const bytes = await readFile(new URL("./fixtures/lectura-escaneada.pdf", import.meta.url));
  const result = await ingestItem({ name: "Lección 01 escaneada.pdf", bytes });
  assert.equal(result.fragments.length, 2, result.warnings.join("; "));
  const [first, second] = result.fragments;
  assert.match(first.location, /^Página 1 \(OCR\)/);
  assert.match(second.location, /^Página 2 \(OCR\)/);
  assert.equal(first.suggestedDayId, "sabado");
  assert.equal(second.suggestedDayId, "domingo");
  assert.match(first.text, /Lectura de estudio/i);
  assert.deepEqual(first.referenceSuggestions, ["Juan 3:16"]);
  assert.deepEqual(second.referenceSuggestions, ["Salmos 23:1-3"]);
  assert.ok(first.warnings.some(message => /Coteja/.test(message)));
});

test("si no hay texto utilizable se conserva la fuente para mapeo manual", async () => {
  let original;
  const result = await ingestItem({ text: "<main><script>único elemento</script></main>", kind: "html" }, {
    onOriginal: item => { original = item; },
  });
  assert.deepEqual(result.fragments, []);
  assert.match(result.warnings[0], /manualmente/);
  assert.match(original.bytes.toString(), /único elemento/);
});
