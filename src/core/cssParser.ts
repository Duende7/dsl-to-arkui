export type StyleMap = Record<string, string>;
export type ClassStyleMap = Record<string, StyleMap>;

// ---- CSS 解析 ----

export function parseCss(css: string): ClassStyleMap {
  const result: ClassStyleMap = {};
  if (!css) return result;

  // 去掉每条规则后的分号再匹配（某些 DSL css 用 `;` 分隔多条规则）
  const ruleRegex = /\.([a-zA-Z0-9_%-]+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(css)) !== null) {
    const className = match[1];
    const declarations = match[2];
    const styleMap: StyleMap = {};

    declarations.split(";").forEach((decl) => {
      const colonIdx = decl.indexOf(":");
      if (colonIdx === -1) return;
      const prop = decl.slice(0, colonIdx).trim();
      const val = decl.slice(colonIdx + 1)
        .replace(/\s*!important\s*$/, "")
        .replace(/[\r\n]+/g, " ")  // 折叠换行（linear-gradient 等多行值）
        .replace(/\s+/g, " ")
        .trim();
      if (prop && val) styleMap[prop] = val;
    });

    result[className] = styleMap;
  }

  return result;
}

// ---- 背景图 URL → ArkUI 资源引用 ----

/** /4_5146.svg → $r('app.media.4_5146')；http://... → "http://..."（网络） */
function urlToBackgroundRes(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return `"${url}"`;
  const name = url.replace(/^\/+/, "").replace(/\.[^.]+$/, "");
  return name ? `$r('app.media.${name}')` : '""';
}

// ---- CSS 颜色格式转换 ----

/**
 * CSS 8位十六进制 #RRGGBBAA → ArkUI #AARRGGBB。
 * ArkUI 解析 8位 hex 时前两位为 alpha，与 CSS 相反。
 * 3/6 位十六进制及其他格式保持不变。
 */
function cssHexToArkUIHex(hex: string): string {
  if (/^#[0-9a-fA-F]{8}$/.test(hex)) {
    const rr = hex.slice(1, 3);
    const gg = hex.slice(3, 5);
    const bb = hex.slice(5, 7);
    const aa = hex.slice(7, 9);
    return `#${aa}${rr}${gg}${bb}`;
  }
  return hex;
}

// ---- linear-gradient 解析 ----

/**
 * 将 CSS linear-gradient 转为 ArkUI .linearGradient() 修饰符。
 * 支持格式：linear-gradient(180deg, #rrggbbaa stop%, ...)
 */
function parseLinearGradient(value: string): string | null {
  // 提取 linear-gradient(...) 括号内内容
  const inner = value.match(/linear-gradient\((.+)\)\s*$/s)?.[1];
  if (!inner) return null;

  // 按逗号分割各段，但逗号可能出现在 rgba() 里，用括号深度跳过
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") { depth++; cur += ch; }
    else if (ch === ")") { depth--; cur += ch; }
    else if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  if (cur.trim()) parts.push(cur.trim());

  if (parts.length < 2) return null;

  // 第一段：角度（如 "180deg"）或方向（如 "to bottom"）
  let angle: number | null = null;
  let colorStart = 0;
  const firstPart = parts[0];
  const degMatch = firstPart.match(/^(-?\d+(?:\.\d+)?)deg$/i);
  if (degMatch) {
    angle = parseFloat(degMatch[1]);
    colorStart = 1;
  } else if (/^to\s+/i.test(firstPart)) {
    // to bottom → 180, to top → 0, to right → 90, to left → 270
    const dir = firstPart.replace(/^to\s+/i, "").trim().toLowerCase();
    angle = { bottom: 180, top: 0, right: 90, left: 270 }[dir] ?? 180;
    colorStart = 1;
  } else {
    // 没有角度，默认 180
    angle = 180;
    colorStart = 0;
  }

  // 解析颜色段："#rrggbbaa 11.8%"  或  "rgba(...) 50%"  或  "#rrggbbaa"
  const colors: string[] = [];
  for (let i = colorStart; i < parts.length; i++) {
    const seg = parts[i].trim();
    // 最后一个空格之前是颜色，之后是 stop（如 11.8%）
    const spaceIdx = seg.lastIndexOf(" ");
    let color: string;
    let stop: string;
    if (spaceIdx !== -1) {
      color = seg.slice(0, spaceIdx).trim();
      stop  = seg.slice(spaceIdx + 1).trim();
    } else {
      // 没有显式 stop，均匀分布
      color = seg;
      stop  = "";
    }
    const stopNum = stop.endsWith("%")
      ? String(Math.round(parseFloat(stop) * 10) / 1000)  // "11.8%" → 0.118
      : stop || String(Math.round((i - colorStart) / (parts.length - colorStart - 1) * 1000) / 1000);

    colors.push(`      ['${cssHexToArkUIHex(color)}', ${stopNum}]`);
  }

  return `.linearGradient({\n    angle: ${angle},\n    colors: [\n${colors.join(",\n")}\n    ]\n  })`;
}

// ---- 长度单位转换 ----

/** 将 CSS 长度值转换为 ArkUI 数值（rem→vp, px→vp, %→字符串） */
function parseLength(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "0") return "0";
  if (trimmed.endsWith("rem")) {
    const n = parseFloat(trimmed) * 16;
    return String(Math.round(n * 10) / 10); // 保留1位小数
  }
  if (trimmed.endsWith("px")) {
    return String(parseFloat(trimmed));
  }
  if (trimmed.endsWith("%")) {
    return `"${trimmed}"`;
  }
  // 纯数字
  if (!isNaN(Number(trimmed))) return trimmed;
  return `"${trimmed}"`;
}

/** 解析多值 shorthand（padding / margin），返回 ArkUI Edges 对象字符串 */
function parseEdges(value: string): string {
  const parts = value.trim().split(/\s+/);
  let top: string, right: string, bottom: string, left: string;

  if (parts.length === 1) {
    const v = parseLength(parts[0]);
    return v; // 单值直接用数字
  } else if (parts.length === 2) {
    const v0 = parseLength(parts[0]);
    const v1 = parseLength(parts[1]);
    top = v0; bottom = v0; left = v1; right = v1;
  } else if (parts.length === 3) {
    top = parseLength(parts[0]);
    right = parseLength(parts[1]);
    left = parseLength(parts[1]);
    bottom = parseLength(parts[2]);
  } else {
    top = parseLength(parts[0]);
    right = parseLength(parts[1]);
    bottom = parseLength(parts[2]);
    left = parseLength(parts[3]);
  }

  // 如果四边相等则简化
  if (top === right && right === bottom && bottom === left) return top;

  return `{ top: ${top}, right: ${right}, bottom: ${bottom}, left: ${left} }`;
}

// ---- CSS 属性 → ArkUI 修饰符 ----

const SKIP_PROPS = new Set([
  "flex-direction",
  "justify-content",
  "align-items",
  "align-self",
  "background-repeat",
  "background-position",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "row-gap",
  "column-gap",
  "gap",
  "display",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "z-index",
  "box-sizing",
  "overflow",
  "white-space",
  "text-overflow",
  "word-break",
  "pointer-events",
  "cursor",
  "list-style",
  "float",
  "clear",
  "content",
  "letter-spacing",
]);

export function convertCssPropToArkUI(prop: string, value: string): string | null {
  if (SKIP_PROPS.has(prop)) return null;

  switch (prop) {
    case "font-size":
      return `.fontSize(${parseLength(value)})`;

    case "color":
      return `.fontColor("${value}")`;

    case "background-color":
      return `.backgroundColor("${value}")`;

    case "background": {
      // linear-gradient → .linearGradient({ angle, colors })
      if (value.includes("linear-gradient")) return parseLinearGradient(value);
      // url(...) → 容器背景图 .backgroundImage()
      if (value.includes("url(")) {
        const m = value.match(/url\(["']?([^"')]+)["']?\)/);
        if (!m) return null;
        const url = m[1];
        const res = urlToBackgroundRes(url);
        return `.backgroundImage(${res})`;
      }
      return `.backgroundColor("${value}")`;
    }

    case "background-size": {
      const v = value.trim().toLowerCase();
      if (v === "cover" || v === "100%" || v === "100% 100%")
        return `.backgroundImageSize(ImageSize.Cover)`;
      if (v === "contain") return `.backgroundImageSize(ImageSize.Contain)`;
      return `.backgroundImageSize(ImageSize.Auto)`;
    }

    case "width":
      // calc(100% - X) → ArkUI 中对应 layoutWeight(1)，占满剩余空间
      if (value.trim().startsWith("calc(")) return `.layoutWeight(1)`;
      return `.width(${parseLength(value)})`;

    case "height":
      if (value.trim().startsWith("calc(")) return null; // 跳过不支持的 calc
      return `.height(${parseLength(value)})`;

    case "flex": {
      // flex: 1 / flex: 2 等 → layoutWeight(n)，表示占满剩余空间
      const n = parseFloat(value);
      if (!isNaN(n) && n > 0) return `.layoutWeight(${n})`;
      return null;
    }

    case "min-width":
      return `.minWidth(${parseLength(value)})`;

    case "max-width":
      return `.maxWidth(${parseLength(value)})`;

    case "min-height":
      return `.minHeight(${parseLength(value)})`;

    case "max-height":
      return `.maxHeight(${parseLength(value)})`;

    case "margin": {
      const v = parseEdges(value);
      return `.margin(${v})`;
    }
    case "margin-top":
      return `.margin({ top: ${parseLength(value)} })`;
    case "margin-right":
      return `.margin({ right: ${parseLength(value)} })`;
    case "margin-bottom":
      return `.margin({ bottom: ${parseLength(value)} })`;
    case "margin-left":
      return `.margin({ left: ${parseLength(value)} })`;

    case "padding": {
      const v = parseEdges(value);
      return `.padding(${v})`;
    }
    case "padding-top":
      return `.padding({ top: ${parseLength(value)} })`;
    case "padding-right":
      return `.padding({ right: ${parseLength(value)} })`;
    case "padding-bottom":
      return `.padding({ bottom: ${parseLength(value)} })`;
    case "padding-left":
      return `.padding({ left: ${parseLength(value)} })`;

    case "font-weight": {
      if (value === "bold") return `.fontWeight(FontWeight.Bold)`;
      if (value === "normal") return `.fontWeight(FontWeight.Normal)`;
      const n = parseInt(value);
      if (!isNaN(n)) return `.fontWeight(${n})`;
      return null;
    }

    case "line-height":
      return `.lineHeight(${parseLength(value)})`;

    case "text-align":
      return `.textAlign(${mapTextAlign(value)})`;

    case "border-radius":
      return `.borderRadius(${parseLength(value)})`;

    case "opacity":
      return `.opacity(${value})`;

    case "border": {
      // "1px solid rgba(...)" → .border({ width, color, style })
      const parts = value.split(/\s+/);
      if (parts.length >= 3) {
        const width = parseLength(parts[0]);
        const style = mapBorderStyle(parts[1]);
        const color = parts.slice(2).join(" ");
        return `.border({ width: ${width}, color: "${color}", style: ${style} })`;
      }
      return null;
    }

    case "border-top":
    case "border-right":
    case "border-bottom":
    case "border-left": {
      // "1px solid rgba(...)" → .border({ width: { side }, color: { side }, style: { side } })
      const parts = value.split(/\s+/);
      if (parts.length >= 3) {
        const side  = prop.slice("border-".length); // "top" | "right" | "bottom" | "left"
        const width = parseLength(parts[0]);
        const style = mapBorderStyle(parts[1]);
        const color = parts.slice(2).join(" ");
        return `.border({ width: { ${side}: ${width} }, color: { ${side}: "${color}" }, style: { ${side}: ${style} } })`;
      }
      return null;
    }

    case "border-color":
      return `.borderColor("${value}")`;

    case "border-width":
      return `.borderWidth(${parseLength(value)})`;

    case "visibility":
      return value === "hidden" ? `.visibility(Visibility.Hidden)` : `.visibility(Visibility.Visible)`;

    case "backdrop-filter": {
      // backdrop-filter: blur(1.875rem) → .backdropBlur(30)
      const m = value.match(/blur\(([^)]+)\)/);
      if (m) return `.backdropBlur(${parseLength(m[1])})`;
      return null;
    }

    default:
      return null;
  }
}

function mapBorderStyle(value: string): string {
  switch (value) {
    case "dashed": return "BorderStyle.Dashed";
    case "dotted": return "BorderStyle.Dotted";
    default:       return "BorderStyle.Solid";
  }
}

function mapTextAlign(value: string): string {
  switch (value) {
    case "center": return "TextAlign.Center";
    case "right":
    case "end": return "TextAlign.End";
    default: return "TextAlign.Start";
  }
}

// ---- StyleMap → ArkUI 修饰符字符串 ----

export function styleMapToArkUI(styleMap: StyleMap, indent: string): string {
  const lines: string[] = [];
  for (const [prop, value] of Object.entries(styleMap)) {
    const modifier = convertCssPropToArkUI(prop, value);
    if (modifier) lines.push(`${indent}${modifier}`);
  }
  return lines.join("\n");
}
