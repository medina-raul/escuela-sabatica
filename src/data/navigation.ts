export type NavSection = "home" | "lessons" | "resources" | "beliefs" | "bible" | "archive";

export type NavItem = {
  section: NavSection;
  label: string;
  href: string;
  external?: boolean;
};

export const navItems: NavItem[] = [
  { section: "home", label: "Inicio", href: "/" },
  { section: "lessons", label: "Lecciones", href: "/#lessons-heading" },
  { section: "resources", label: "Recursos", href: "/recursos" },
  { section: "beliefs", label: "28 creencias", href: "/creencias" },
  { section: "archive", label: "Trimestres", href: "/trimestres" },
  { section: "bible", label: "Biblia", href: "https://www.santabiblia.cloud", external: true },
];

export function quarterNavItems(quarterId?: string): NavItem[] {
  if (!quarterId) return navItems;
  const base = `/trimestres/${encodeURIComponent(quarterId)}`;
  return navItems.map(item => ({ ...item, href: item.section === "home" ? base
    : item.section === "lessons" ? `${base}/#lessons-heading`
    : item.section === "resources" ? `${base}/recursos` : item.href }));
}
