export type NavSection = "home" | "lessons" | "resources" | "bible" | "archive";

export type NavItem = {
  section: NavSection;
  label: string;
  href: string;
  icon: string;
  external?: boolean;
};

export const navItems: NavItem[] = [
  { section: "home", label: "Inicio", href: "/", icon: "⌂" },
  { section: "lessons", label: "Lecciones", href: "/#lessons-heading", icon: "▣" },
  { section: "resources", label: "Recursos", href: "/recursos", icon: "▤" },
  { section: "archive", label: "Trimestres", href: "/trimestres", icon: "▦" },
  { section: "bible", label: "Biblia", href: "https://www.santabiblia.cloud", icon: "□", external: true },
];

export function quarterNavItems(quarterId?: string): NavItem[] {
  if (!quarterId) return navItems;
  const base = `/trimestres/${encodeURIComponent(quarterId)}`;
  return navItems.map(item => ({ ...item, href: item.section === "home" ? base
    : item.section === "lessons" ? `${base}/#lessons-heading`
    : item.section === "resources" ? `${base}/recursos` : item.href }));
}
