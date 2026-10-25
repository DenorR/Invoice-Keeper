import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Drawer,
  Menu,
  Modal,
  Paper,
  Popover,
  SegmentedControl,
  Select,
  Tabs,
  TextInput,
  Tooltip,
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type MantineTransition,
} from "@mantine/core";

// Фирменный стиль aéza (брендбук 2026):
//   основные цвета — голубой #4CC6F1, чёрный #000000, светло-серый #F4F4F4;
//   дополнительные — тёмно-синий #182D48, оранжевый #E97C35;
//   шрифты — Exo 2 (заголовки) и Inter (интерфейс).

// Голубой aéza. Палитра называется "blue", чтобы все места с color="blue" и основной цвет стали фирменными.
const aeza: MantineColorsTuple = [
  "#e9f8fe",
  "#d3f1fc",
  "#a7e3f9",
  "#7bd5f6",
  "#5ecdf3",
  "#4cc6f1", // фирменный
  "#2cb3e4",
  "#1797c6",
  "#0f789f",
  "#0a5a78",
];

// Оранжевый aéza — предупреждения и «скоро срок».
const orange: MantineColorsTuple = [
  "#fdf1e8",
  "#fbe2d1",
  "#f6c3a1",
  "#f1a26e",
  "#ed8b4b",
  "#e97c35", // фирменный
  "#d76a23",
  "#b5561a",
  "#914415",
  "#6e3310",
];

// Тёмно-синий aéza — акценты администратора.
const navy: MantineColorsTuple = [
  "#e9eef5",
  "#d2dbe7",
  "#a6b7cf",
  "#7792b6",
  "#52739f",
  "#3a5c89",
  "#2b4870",
  "#213a5c",
  "#182d48", // фирменный
  "#0f1e31",
];

// Нейтральные серые от фирменного #F4F4F4 (светлая тема).
const gray: MantineColorsTuple = [
  "#f4f4f4", // фирменный
  "#efeff0",
  "#e8e9eb",
  "#dee0e3",
  "#cdd0d5",
  "#9da2aa",
  "#6b7079",
  "#4a4f57",
  "#2e3137",
  "#17191c",
];

// Тёмная тема: почти чёрный с лёгким оттенком фирменного тёмно-синего.
const dark: MantineColorsTuple = [
  "#f4f4f5", // текст
  "#cfd0d4",
  "#9a9ca3", // приглушённый текст
  "#62646b",
  "#3a3b40", // границы
  "#2a2b2f",
  "#1d1e21", // поля ввода, кнопки по умолчанию
  "#141518", // карточки, шапка, меню
  "#0b0c0e", // фон страницы
  "#060607",
];

// ─── движение (принципы Эмиля Ковальски): быстро, ease-out, без появления «из ничего» ───
// Мягкий ease-out (easeOutQuint): быстрое начало и долгое плавное завершение — без резких остановок.
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
export const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";

/** Всплывающее окно проявляется от своего триггера: почти без масштаба (0.98) и с лёгким сдвигом — мягко, без «прыжка». */
export function popFrom(origin: string): MantineTransition {
  const dy = origin.startsWith("bottom") ? "4px" : origin === "center" ? "8px" : "-4px";
  return {
    in: { opacity: 1, transform: "translateY(0) scale(1)" },
    out: { opacity: 0, transform: `translateY(${dy}) scale(0.98)` },
    common: { transformOrigin: origin },
    transitionProperty: "transform, opacity",
  };
}

export const theme = createTheme({
  primaryColor: "blue",
  primaryShade: { light: 5, dark: 5 },
  autoContrast: true, // на голубой заливке — чёрный текст, как в брендбуке
  colors: { blue: aeza, aeza, orange, navy, gray, dark },
  black: "#000000",
  white: "#ffffff",
  defaultRadius: "md",
  radius: { xs: "4px", sm: "6px", md: "10px", lg: "14px", xl: "22px" },
  fontFamily: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  headings: {
    fontFamily: "'Exo 2 Variable', 'Exo 2', 'Inter Variable', sans-serif",
    fontWeight: "800",
    sizes: {
      h1: { fontSize: "32px", lineHeight: "1.15" },
      h2: { fontSize: "26px", lineHeight: "1.2" },
      h3: { fontSize: "20px", lineHeight: "1.3" },
      h4: { fontSize: "16px", lineHeight: "1.4", fontWeight: "700" },
      h5: { fontSize: "14px", lineHeight: "1.4", fontWeight: "700" },
      h6: { fontSize: "13px", lineHeight: "1.4", fontWeight: "700" },
    },
  },
  shadows: {
    xs: "0 1px 2px rgba(16, 24, 40, 0.04)",
    sm: "0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.04)",
    md: "0 4px 12px rgba(16, 24, 40, 0.08), 0 1px 3px rgba(16, 24, 40, 0.05)",
    lg: "0 12px 32px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.06)",
    xl: "0 24px 48px rgba(16, 24, 40, 0.16)",
  },
  cursorType: "pointer",
  components: {
    Card: Card.extend({ defaultProps: { radius: "xl", padding: "lg", withBorder: true } }),
    Paper: Paper.extend({ defaultProps: { radius: "lg" } }),
    Button: Button.extend({ defaultProps: { radius: "md" } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: "md" } }),
    Badge: Badge.extend({ defaultProps: { radius: "sm" } }),
    TextInput: TextInput.extend({ defaultProps: { radius: "md" } }),
    Select: Select.extend({ defaultProps: { radius: "md", comboboxProps: { transitionProps: { transition: popFrom("top center"), duration: 220, timingFunction: EASE_OUT } } } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: "md" } }),
    Tabs: Tabs.extend({ defaultProps: { radius: "md" } }),
    Modal: Modal.extend({
      defaultProps: {
        radius: "lg",
        centered: true,
        overlayProps: { backgroundOpacity: 0.4, blur: 1 },
        transitionProps: { transition: popFrom("center"), duration: 320, exitDuration: 220, timingFunction: EASE_OUT },
        removeScrollProps: { removeScrollBar: false },
      },
    }),
    Drawer: Drawer.extend({
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.3, blur: 0 },
        transitionProps: { duration: 460, exitDuration: 300, timingFunction: EASE_DRAWER },
        removeScrollProps: { removeScrollBar: false },
      },
    }),
    Menu: Menu.extend({ defaultProps: { radius: "md", shadow: "md", transitionProps: { transition: popFrom("top right"), duration: 220, timingFunction: EASE_OUT } } }),
    Popover: Popover.extend({ defaultProps: { radius: "lg", shadow: "lg", transitionProps: { transition: popFrom("top left"), duration: 240, timingFunction: EASE_OUT } } }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: "sm", openDelay: 350, transitionProps: { transition: "fade", duration: 180 } } }),
  },
});

/**
 * Фон — мягкие волны голубого aéza и белого. Это залитые волнистые слои, а не линии;
 * размытие «запечено» в картинку (feGaussianBlur), поэтому переходы плавные и ничего не отвлекает от данных.
 */
type WaveColors = { blue: string; blueSoft: string; white: string };

function brandWaves(c: WaveColors, blur: number) {
  const wave = (fill: string, d: string) => `<path fill="${fill}" d="${d}"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">` +
    `<defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>` +
    `<g filter="url(#b)">` +
    // верхняя голубая волна и белая поверх неё
    wave(c.blueSoft, "M-200 -200H1800V260C1500 360 1220 170 900 250S300 380 -200 280Z") +
    wave(c.white, "M-200 -200H1800V150C1520 230 1240 90 940 160S320 260 -200 190Z") +
    // широкая голубая волна через середину
    wave(c.blue, "M-200 560C120 470 420 650 760 590S1380 450 1800 540V760C1460 680 1160 830 820 780S180 640 -200 720Z") +
    // белая волна и мягкая голубая внизу
    wave(c.white, "M-200 760C180 690 520 860 880 800S1460 690 1800 760V1200H-200Z") +
    wave(c.blueSoft, "M-200 900C200 840 560 980 940 930S1500 840 1800 900V1200H-200Z") +
    `</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// В тёмной теме Mantine делает «светлые» плашки (бейджи, алерты, активный пункт меню) почти непрозрачными —
// на нашем почти чёрном фоне они выходят тяжёлыми. Делаем их полупрозрачным оттенком цвета.
function darkLightVariants(t: Parameters<CSSVariablesResolver>[0]) {
  const vars: Record<string, string> = {};
  for (const [name, shades] of Object.entries(t.colors)) {
    if (name === "dark") continue;
    const base = name === "gray" ? shades[5] : name === "navy" ? shades[4] : shades[6];
    const strength = name === "navy" ? 0.32 : name === "gray" ? 0.2 : 0.16;
    vars[`--mantine-color-${name}-light`] = rgba(base, strength);
    vars[`--mantine-color-${name}-light-hover`] = rgba(base, strength + 0.08);
    vars[`--mantine-color-${name}-light-color`] = name === "gray" || name === "navy" ? shades[1] : shades[3];
  }
  return vars;
}

// Голубой #4CC6F1 на белом читается плохо, поэтому текст и ссылки этим цветом в светлой теме — темнее.
// Стекло нейтральное: белая (светлая тема) или светлая на тёмном (тёмная тема) вуаль с размытием.
// Оно только рассеивает фон и не меняет его цвет — без saturate и без цветного оттенка.
export const cssVariablesResolver: CSSVariablesResolver = (t) => ({
  variables: {
    "--ik-ease-out": EASE_OUT,
    "--ik-ease-drawer": EASE_DRAWER,
  },
  light: {
    "--mantine-color-body": t.white,
    "--mantine-color-default-border": "rgba(0, 0, 0, 0.1)",
    "--mantine-color-default": "rgba(255, 255, 255, 0.6)",
    "--mantine-color-default-hover": "rgba(255, 255, 255, 0.85)",
    "--ik-border": "rgba(0, 0, 0, 0.07)",
    "--ik-border-strong": "rgba(0, 0, 0, 0.14)",
    "--ik-surface": "#ffffff",
    "--ik-surface-2": "rgba(0, 0, 0, 0.025)",
    "--ik-hover": "rgba(0, 0, 0, 0.04)",
    "--ik-active": "rgba(0, 0, 0, 0.065)",
    "--ik-card-shadow": "0 1px 2px rgba(0, 0, 0, 0.04)",
    // карточки — плотное матовое стекло, как bg-card: тонкая рамка и мягкая тень 0 2px 10px
    "--ik-glass-bg": "rgba(255, 255, 255, 0.72)",
    "--ik-glass-strong": "rgba(255, 255, 255, 0.86)",
    "--ik-glass-stroke": "rgba(0, 0, 0, 0.07)",
    "--ik-glass-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 2px 10px rgba(0, 0, 0, 0.04)",
    "--ik-dots": "rgba(0, 0, 0, 0.13)",
    "--ik-tone-red": "#e11d48",
    "--ik-tone-green": "#059669",
    "--ik-tone-yellow": "#b45309",
    "--ik-tone-blue": "#0e8fbf",
    "--ik-ambient": "#eff1f4",
    "--mantine-color-anchor": "var(--mantine-color-text)",
    "--mantine-color-blue-text": "var(--mantine-color-blue-8)",
    "--mantine-color-aeza-text": "var(--mantine-color-blue-8)",
    "--ik-page-bg": "#f2f5f8",
    "--ik-pattern": brandWaves({ blue: "rgba(76, 198, 241, 0.42)", blueSoft: "rgba(76, 198, 241, 0.22)", white: "rgba(255, 255, 255, 0.9)" }, 46),
  },
  dark: {
    ...darkLightVariants(t),
    "--mantine-color-default-border": "rgba(255, 255, 255, 0.1)",
    "--mantine-color-default": "rgba(255, 255, 255, 0.05)",
    "--mantine-color-default-hover": "rgba(255, 255, 255, 0.09)",
    "--ik-border": "rgba(255, 255, 255, 0.07)",
    "--ik-border-strong": "rgba(255, 255, 255, 0.14)",
    "--ik-surface": t.colors.dark[7],
    "--ik-surface-2": "rgba(255, 255, 255, 0.025)",
    "--ik-hover": "rgba(255, 255, 255, 0.05)",
    "--ik-active": "rgba(255, 255, 255, 0.08)",
    "--ik-card-shadow": "none",
    "--ik-glass-bg": "rgba(22, 23, 26, 0.62)",
    "--ik-glass-strong": "rgba(24, 25, 28, 0.86)",
    "--ik-glass-stroke": "rgba(255, 255, 255, 0.08)",
    "--ik-glass-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 2px 10px rgba(0, 0, 0, 0.25)",
    "--ik-dots": "rgba(255, 255, 255, 0.13)",
    "--ik-tone-red": "#fb7185",
    "--ik-tone-green": "#34d399",
    "--ik-tone-yellow": "#fbbf24",
    "--ik-tone-blue": "#4cc6f1",
    "--ik-ambient": "#0b0c0e",
    "--mantine-color-anchor": "var(--mantine-color-text)",
    "--mantine-color-blue-text": "var(--mantine-color-blue-4)",
    "--ik-page-bg": "#0b0c0e",
    "--ik-pattern": brandWaves({ blue: "rgba(76, 198, 241, 0.2)", blueSoft: "rgba(76, 198, 241, 0.1)", white: "rgba(255, 255, 255, 0.05)" }, 50),
  },
});
