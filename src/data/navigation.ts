import { siteConfig, type NavItem, type NavSection } from "./siteConfig";

export type { NavItem, NavSection };

export const navItems = siteConfig.navigation.filter(item => item.visible !== false);

export function quarterNavItems(quarterId?: string): NavItem[] {
  if (!quarterId) return navItems;
  const base = `/trimestres/${encodeURIComponent(quarterId)}`;
  return navItems.map(item => ({ ...item, href: item.section === "home" && item.href === "/" ? base
    : item.section === "lessons" && item.href === "/#lessons-heading" ? `${base}/#lessons-heading`
    : item.section === "resources" && item.href === "/recursos" ? `${base}/recursos` : item.href }));
}
