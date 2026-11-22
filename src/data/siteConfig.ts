import config from "./site-config.json";

export type NavSection = "home" | "lessons" | "resources" | "beliefs" | "bible" | "archive" | "custom";
export type NavItem = {
  section: NavSection;
  label: string;
  href: string;
  external?: boolean;
  visible?: boolean;
  mobile?: boolean;
};

type Palette = "clasica" | "azul" | "oliva";
type ReadingFont = "literata" | "lora" | "georgia";

type SiteWidget = {
  id: string;
  type: "weekly-presentation" | "teacher-reading" | "complementary-book" | "reavivados"
    | "friday-reading" | "resource-library" | "notice" | "link";
  title: string;
  enabled: boolean;
  placement?: "sidebar";
  quarterId?: string;
  dayId?: string;
  text?: string;
  href?: string;
};

type FeaturedLink = {
  label: string;
  description: string;
  href: string;
  iconUrl?: string;
};

type SiteConfig = {
  schemaVersion: number;
  navigation: NavItem[];
  theme: { palette: Palette; readingFont: ReadingFont; accent?: string };
  widgets: SiteWidget[];
  seo: { title: string; description: string; image: string };
  footer: { brand: string; credits: string; links: FeaturedLink[] };
};

export const siteConfig = config as SiteConfig;

const palettes: Record<Palette, Record<string, string>> = {
  clasica: {},
  azul: { "--color-navy-900": "#113354", "--color-navy-800": "#174a6e", "--color-blue-700": "#316395" },
  oliva: { "--color-navy-900": "#233f35", "--color-navy-800": "#385747", "--color-blue-700": "#396857" },
};

const readingFonts: Record<ReadingFont, string | undefined> = {
  literata: undefined,
  lora: 'Lora, Georgia, "Times New Roman", serif',
  georgia: 'Georgia, "Times New Roman", serif',
};

export function siteThemeStyle(): Record<string, string> {
  const { palette, readingFont, accent } = siteConfig.theme;
  const font = readingFonts[readingFont];
  return {
    ...palettes[palette],
    ...(font ? { "--font-reading": font } : {}),
    ...(accent && /^#[a-f\d]{6}$/i.test(accent) ? { "--color-gold-500": accent } : {}),
  };
}
