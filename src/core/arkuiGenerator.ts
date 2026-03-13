import { parseCss, styleMapToArkUI, ClassStyleMap, StyleMap } from "./cssParser";
import publicClassCss from "../publicClass.css?raw";

// 全局公共样式表（一次性解析，作为 fallback）
const PUBLIC_CLASS_STYLE_MAP: ClassStyleMap = parseCss(publicClassCss);

// ---- 接口定义 ----

export interface DslNode {
  guid?: string;
  name?: string;
  componentName: string;
  props?: {
    className?: string;
    src?: string;
    placeholder?: string;
    [key: string]: unknown;
  };
  children?: DslNode[] | string;
  scriptCode?: unknown[];
  [key: string]: unknown;
}

export interface DslPage {
  fileName: string;
  css?: string;
  guid?: string;
  name?: string;
  componentName?: string;
  props?: { className?: string; [key: string]: unknown };
  children?: DslNode[];
  [key: string]: unknown;
}

// ---- 组件类型 ----

type ArkUIComponent =
  | "Row" | "Column" | "Text" | "Image"
  | "Button" | "TextInput" | "TextArea";

// ---- FlexInfo：存储原始语义值 ----

interface FlexInfo {
  isFlex: boolean;
  direction: "row" | "column";
  /** "start" | "end" | "center" | "space-between" | "space-around" | "space-evenly" */
  justify?: string;
  /** "start" | "end" | "center" | "stretch" */
  align?: string;
}

// ---- className 中的复合 flex 类解析 ----

const JUSTIFY_SHORTHAND: Record<string, string> = {
  between: "space-between",
  around:  "space-around",
  evenly:  "space-evenly",
  start:   "start",
  end:     "end",
  center:  "center",
};

const ALIGN_SHORTHAND: Record<string, string> = {
  center:  "center",
  start:   "start",
  end:     "end",
  stretch: "stretch",
};

function parseFlexFromClassNames(classNames: string[]): FlexInfo {
  let isFlex = false;
  let direction: "row" | "column" = "row";
  let justify: string | undefined;
  let align: string | undefined;

  for (const cls of classNames) {
    if (cls === "flex") { isFlex = true; continue; }
    if (cls === "flex-column") { isFlex = true; direction = "column"; continue; }
    if (cls === "flex-row")    { isFlex = true; direction = "row";    continue; }

    // flex-{justify} 或 flex-{justify}-{align}
    if (cls.startsWith("flex-")) {
      isFlex = true;
      const rest  = cls.slice(5);
      const parts = rest.split("-");
      if (parts[0] && JUSTIFY_SHORTHAND[parts[0]]) {
        justify = JUSTIFY_SHORTHAND[parts[0]];
      }
      if (parts[1] && ALIGN_SHORTHAND[parts[1]]) {
        align = ALIGN_SHORTHAND[parts[1]];
      }
    }
  }

  return { isFlex, direction, justify, align };
}

// ---- 用 CSS 补充 FlexInfo ----

const CSS_DIR_MAP: Record<string, "row" | "column"> = {
  row:             "row",
  column:          "column",
  "row-reverse":   "row",
  "column-reverse":"column",
};

const CSS_JUSTIFY_MAP: Record<string, string> = {
  "flex-start":    "start",
  "flex-end":      "end",
  center:          "center",
  "space-between": "space-between",
  "space-around":  "space-around",
  "space-evenly":  "space-evenly",
};

const CSS_ALIGN_MAP: Record<string, string> = {
  "flex-start": "start",
  "flex-end":   "end",
  center:       "center",
  stretch:      "stretch",
};

function mergeFlexFromCss(info: FlexInfo, styleMap: StyleMap): FlexInfo {
  const result = { ...info };
  if (styleMap["flex-direction"] && CSS_DIR_MAP[styleMap["flex-direction"]]) {
    result.direction = CSS_DIR_MAP[styleMap["flex-direction"]];
  }
  if (!result.justify && styleMap["justify-content"]) {
    result.justify = CSS_JUSTIFY_MAP[styleMap["justify-content"]] ?? undefined;
  }
  if (!result.align && styleMap["align-items"]) {
    result.align = CSS_ALIGN_MAP[styleMap["align-items"]] ?? undefined;
  }
  return result;
}

// ---- 对齐枚举转换 ----

const FLEX_ALIGN_MAP: Record<string, string> = {
  "start":        "FlexAlign.Start",
  "end":          "FlexAlign.End",
  "center":       "FlexAlign.Center",
  "space-between":"FlexAlign.SpaceBetween",
  "space-around": "FlexAlign.SpaceAround",
  "space-evenly": "FlexAlign.SpaceEvenly",
};

// Row 的交叉轴用 VerticalAlign
const VERTICAL_ALIGN_MAP: Record<string, string> = {
  start:   "VerticalAlign.Top",
  end:     "VerticalAlign.Bottom",
  center:  "VerticalAlign.Center",
  stretch: "VerticalAlign.Center",
};

// Column 的交叉轴用 HorizontalAlign
const HORIZONTAL_ALIGN_MAP: Record<string, string> = {
  start:   "HorizontalAlign.Start",
  end:     "HorizontalAlign.End",
  center:  "HorizontalAlign.Center",
  stretch: "HorizontalAlign.Center",
};


// ---- 绝对定位辅助 ----

/** rem/px → vp 数值（用于 .position()） */
function parsePositionValue(val: string): number {
  const n = parseFloat(val);
  if (isNaN(n)) return 0;
  if (val.includes("rem")) return Math.round(n * 16 * 10) / 10;
  return n;
}

/** 判断节点是否有 absolute 类名 */
function isAbsoluteNode(node: DslNode): boolean {
  return (node.props?.className ?? "").split(/\s+/).includes("absolute");
}

/** 绝对定位信息（供 .markAnchor() / .position() 修饰符使用） */
interface AbsolutePos {
  /** .position() x 值，如 "0" / "110" / "'100%'" / "'calc(100% - 16vp)'" */
  px: string;
  /** .position() y 值 */
  py: string;
  /** .markAnchor() x 值（仅 right 定位时需要） */
  mx?: string;
  /** .markAnchor() y 值（仅 bottom 定位时需要） */
  my?: string;
}

/**
 * 解析绝对定位节点的 CSS 定位属性 → AbsolutePos。
 * 支持 top/left（直接映射到 position x/y）
 * 以及 right/bottom（转换为 markAnchor + position 百分比写法）。
 */
function getNodePosition(
  node: DslNode,
  classStyleMap: ClassStyleMap
): AbsolutePos {
  const cls = (node.props?.className ?? "").split(/\s+/).filter(Boolean);
  const merged: StyleMap = {};
  for (const c of cls) {
    if (PUBLIC_CLASS_STYLE_MAP[c]) Object.assign(merged, PUBLIC_CLASS_STYLE_MAP[c]);
  }
  for (const c of cls) {
    if (classStyleMap[c]) Object.assign(merged, classStyleMap[c]);
  }

  // x 轴：优先 left，否则用 right
  let px: string;
  let mx: string | undefined;
  if (merged["left"] !== undefined) {
    px = String(parsePositionValue(merged["left"]));
  } else if (merged["right"] !== undefined) {
    const r = parsePositionValue(merged["right"]);
    px = r === 0 ? "'100%'" : `'calc(100% - ${r}vp)'`;
    mx = "'100%'";
  } else {
    px = "0";
  }

  // y 轴：优先 top，否则用 bottom
  let py: string;
  let my: string | undefined;
  if (merged["top"] !== undefined) {
    py = String(parsePositionValue(merged["top"]));
  } else if (merged["bottom"] !== undefined) {
    const b = parsePositionValue(merged["bottom"]);
    py = b === 0 ? "'100%'" : `'calc(100% - ${b}vp)'`;
    my = "'100%'";
  } else {
    py = "0";
  }

  return { px, py, mx, my };
}

// ---- 是否为图片节点（static/icon 前缀 + CSS 有 background url） ----

function isImageNode(
  classNames: string[],
  mergedStyle: StyleMap,
  hasChildren: boolean
): boolean {
  // 有真实子节点的是容器，不视为图片
  if (hasChildren) return false;
  const hasSuspectClass = classNames.some(
    (cls) =>
      cls === "static" || cls.startsWith("static-") ||
      cls === "icon"   || cls.startsWith("icon-")
  );
  if (!hasSuspectClass) return false;
  // 必须同时在合并后的 CSS 中找到 background url，避免误判
  return (mergedStyle["background"] ?? "").includes("url(");
}

// Image 组件支持的属性集合（不含文字属性）
const IMAGE_ALLOWED_PROPS = new Set([
  "width", "height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-radius", "opacity", "border", "border-color", "border-width",
  "border-top", "border-right", "border-bottom", "border-left",
  "min-width", "max-width", "min-height", "max-height",
]);

// ---- 从 CSS 提取背景图 URL ----

function extractBackgroundUrl(classNames: string[], classStyleMap: ClassStyleMap): string {
  for (const cls of classNames) {
    const bg = classStyleMap[cls]?.["background"] ?? "";
    const m  = bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (m) return m[1];
  }
  return "";
}

// ---- 图片路径 → ArkUI 资源引用 ----

/**
 * 将 CSS background-url 或 src 路径转为 ArkUI 资源引用格式。
 * /2_928.svg → $r('app.media.2_928')
 * 网络 URL 保持为字符串。
 */
function toArkUIResource(url: string): string {
  if (!url) return '""';
  if (url.startsWith("http://") || url.startsWith("https://")) return `"${url}"`;
  // 去掉开头斜杠和文件扩展名
  const name = url.replace(/^\/+/, "").replace(/\.[^.]+$/, "");
  if (!name) return '""';
  return `$r('app.media.${name}')`;
}

// ---- 从 CSS 获取 background-size → objectFit ----

function getObjectFit(classNames: string[], classStyleMap: ClassStyleMap): string {
  for (const cls of classNames) {
    const size = classStyleMap[cls]?.["background-size"] ?? "";
    if (!size) continue;
    if (size === "100%")         return "ImageFit.Fill";
    if (size.includes("cover"))  return "ImageFit.Cover";
    if (size.includes("contain"))return "ImageFit.Contain";
  }
  return "";
}

// ---- CSS 单行垂直居中检测（height == line-height） ----

/** 把 CSS 长度值转为数值（rem×16，px原值），用于比较 */
function parseLengthNum(val: string): number {
  const n = parseFloat(val);
  if (isNaN(n)) return -1;
  if (val.includes("rem")) return Math.round(n * 16 * 100) / 100;
  return n;
}

/**
 * 检测 CSS 的 height == line-height 这种单行垂直居中技巧。
 * 在 ArkUI 中 Text 无此特性，需要用 Column + justifyContent(FlexAlign.Center) 代替。
 */
function isCssSingleLineCenter(styleMap: StyleMap): boolean {
  const h  = styleMap["height"];
  const lh = styleMap["line-height"];
  if (!h || !lh) return false;
  return Math.abs(parseLengthNum(h) - parseLengthNum(lh)) < 0.1;
}

// 属于文字样式的 CSS 属性（放到内层 Text 上）
const TEXT_STYLE_PROPS = new Set([
  "font-size", "color", "font-weight", "text-align",
  "letter-spacing", "text-decoration", "font-style",
]);

// 属于容器布局的 CSS 属性（放到外层 Column 上）
const LAYOUT_PROPS = new Set([
  "width", "height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-radius", "background-color", "background",
  "opacity", "border", "border-color", "border-width",
  "min-width", "max-width", "min-height", "max-height",
]);

/**
 * 生成 "Column 包裹 Text" 结构，用于替代 CSS height == line-height 垂直居中技巧。
 * Column 拿走布局属性 + justifyContent(FlexAlign.Center)
 * 内层 Text 拿走文字样式属性（不含 line-height）
 */
function generateTextInColumn(
  text: string,
  mergedStyle: StyleMap,
  indent: string,
  propIndent: string
): string {
  const textIndent   = propIndent + "  ";
  const columnStyle: StyleMap = {};
  const textStyle:   StyleMap = {};

  for (const [prop, val] of Object.entries(mergedStyle)) {
    if (LAYOUT_PROPS.has(prop))      columnStyle[prop] = val;
    else if (TEXT_STYLE_PROPS.has(prop)) textStyle[prop] = val;
    // line-height 刻意跳过：垂直居中由 Column justifyContent 实现
  }

  // text-align → Column 交叉轴对齐
  const textAlignVal = mergedStyle["text-align"] ?? "";
  const hAlign =
    textAlignVal === "center" ? "HorizontalAlign.Center" :
    textAlignVal === "right"  ? "HorizontalAlign.End"   :
    "HorizontalAlign.Start";

  const innerStyles = styleMapToArkUI(textStyle, textIndent);
  const innerText   = [
    `${propIndent}Text("${escapeStr(text)}")`,
    innerStyles,
  ].filter(Boolean).join("\n");

  const outerStyles = styleMapToArkUI(columnStyle, indent);

  return [
    `${indent}Column() {`,
    innerText,
    `${indent}}`,
    `${indent}.justifyContent(FlexAlign.Center)`,
    `${indent}.alignItems(${hAlign})`,
    outerStyles,
  ].filter(Boolean).join("\n");
}

// ---- 组件类型判断 ----

function getArkUIComponent(
  node: DslNode,
  classNames: string[],
  mergedStyle: StyleMap,
  hasChildren: boolean
): ArkUIComponent {
  const tag = node.componentName.toLowerCase();

  // 图片节点（static/icon 前缀 + CSS 有 background url + 无子节点）
  if (isImageNode(classNames, mergedStyle, hasChildren)) return "Image";

  switch (tag) {
    case "span":
    case "p":
    case "h1": case "h2": case "h3":
    case "h4": case "h5": case "h6":
    case "label":
      return "Text";

    case "img":
      return "Image";

    case "button":
      return "Button";

    case "input":
      return "TextInput";

    case "textarea":
      return "TextArea";

    default: {
      const flexInfo = parseFlexFromClassNames(classNames);
      if (!flexInfo.isFlex) return "Column";
      const merged = mergeFlexFromCss(flexInfo, mergedStyle);
      return merged.direction === "column" ? "Column" : "Row";
    }
  }
}

// ---- 节点代码生成 ----

function generateNode(
  node: DslNode,
  classStyleMap: ClassStyleMap,
  depth: number,
  absolutePos?: AbsolutePos
): string {
  const indent     = "  ".repeat(depth);
  const propIndent = "  ".repeat(depth + 1);
  // 如果父容器通过 Stack() 给此节点传入了绝对坐标，在末尾追加定位修饰符
  let posSuffix = "";
  if (absolutePos) {
    const { px, py, mx, my } = absolutePos;
    // right/bottom 定位时需要 markAnchor 来移动元素的参考锚点
    if (mx !== undefined || my !== undefined) {
      posSuffix += `\n${indent}.markAnchor({ x: ${mx ?? "0"}, y: ${my ?? "0"} })`;
    }
    posSuffix += `\n${indent}.position({ x: ${px}, y: ${py} })`;
  }

  const classNames = (node.props?.className ?? "").split(/\s+/).filter(Boolean);

  // 收集 CSS 样式：先叠 publicClass（全局公共，低优先级），再叠 page CSS（高优先级）
  const mergedStyle: StyleMap = {};
  for (const cls of classNames) {
    if (PUBLIC_CLASS_STYLE_MAP[cls]) Object.assign(mergedStyle, PUBLIC_CLASS_STYLE_MAP[cls]);
  }
  for (const cls of classNames) {
    if (classStyleMap[cls]) Object.assign(mergedStyle, classStyleMap[cls]);
  }

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const component = getArkUIComponent(node, classNames, mergedStyle, hasChildren);

  // ---- Image（静态资源节点） ----
  if (component === "Image") {
    const isBgImage = isImageNode(classNames, mergedStyle, false);
    const src = isBgImage
      ? extractBackgroundUrl(classNames, classStyleMap)
      : ((node.props?.src as string) ?? "");
    const objectFit = isBgImage
      ? getObjectFit(classNames, classStyleMap)
      : "";
    // Image 只输出布局相关属性，不能有文字属性
    const imageStyle: StyleMap = {};
    for (const [k, v] of Object.entries(mergedStyle)) {
      if (IMAGE_ALLOWED_PROPS.has(k)) imageStyle[k] = v;
    }
    const styles = styleMapToArkUI(imageStyle, propIndent);
    const lines = [`${indent}Image(${toArkUIResource(src)})`];
    if (objectFit) lines.push(`${propIndent}.objectFit(${objectFit})`);
    if (styles)    lines.push(styles);
    return lines.join("\n") + posSuffix;
  }

  // ---- Text ----
  if (component === "Text") {
    const text   = typeof node.children === "string" ? node.children : "";
    const styles = styleMapToArkUI(mergedStyle, propIndent);

    // 根据 text-single / text-multiple 公共类生成对应 ArkUI 修饰符
    const isSingleLine = classNames.includes("text-single");
    const isMultiLine  = classNames.includes("text-multiple");
    const textModifiers: string[] = [];

    if (isSingleLine) {
      textModifiers.push(`${propIndent}.maxLines(1)`);
      textModifiers.push(`${propIndent}.textOverflow({ overflow: TextOverflow.Ellipsis })`);
    } else if (isMultiLine) {
      // 若同时设置了 height 和 line-height，计算最多可显示的行数
      const h  = mergedStyle["height"]      ? parseLengthNum(mergedStyle["height"])      : 0;
      const lh = mergedStyle["line-height"] ? parseLengthNum(mergedStyle["line-height"]) : 0;
      if (h > 0 && lh > 0) {
        const maxLines = Math.floor(h / lh);
        if (maxLines > 1) textModifiers.push(`${propIndent}.maxLines(${maxLines})`);
      }
      textModifiers.push(`${propIndent}.wordBreak(WordBreak.BREAK_ALL)`);
    }

    return [
      `${indent}Text("${escapeStr(text)}")`,
      styles,
      ...textModifiers,
    ].filter(Boolean).join("\n") + posSuffix;
  }

  // ---- Button ----
  if (component === "Button") {
    const text   = typeof node.children === "string" ? node.children : "";
    const styles = styleMapToArkUI(mergedStyle, propIndent);
    return [`${indent}Button("${escapeStr(text)}")`, styles].filter(Boolean).join("\n") + posSuffix;
  }

  // ---- TextInput ----
  if (component === "TextInput") {
    const placeholder = (node.props?.placeholder as string) ?? "";
    const styles = styleMapToArkUI(mergedStyle, propIndent);
    return [
      `${indent}TextInput({ placeholder: "${placeholder}" })`,
      styles,
    ].filter(Boolean).join("\n") + posSuffix;
  }

  // ---- TextArea ----
  if (component === "TextArea") {
    const placeholder = (node.props?.placeholder as string) ?? "";
    const styles = styleMapToArkUI(mergedStyle, propIndent);
    return [
      `${indent}TextArea({ placeholder: "${placeholder}" })`,
      styles,
    ].filter(Boolean).join("\n") + posSuffix;
  }

  // ---- 容器节点有纯文字子节点 ----
  if (typeof node.children === "string" && node.children) {
    // CSS height == line-height 是单行垂直居中技巧，ArkUI Text 不支持此特性
    // → 改用 Column + justifyContent(FlexAlign.Center) 实现垂直居中
    if (isCssSingleLineCenter(mergedStyle)) {
      return generateTextInColumn(node.children, mergedStyle, indent, propIndent) + posSuffix;
    }
    // 普通情况：ArkUI Text 支持 width/height/backgroundColor/padding/margin
    const styles = styleMapToArkUI(mergedStyle, propIndent);
    return [
      `${indent}Text("${escapeStr(node.children)}")`,
      styles,
    ].filter(Boolean).join("\n") + posSuffix;
  }

  // ---- Row / Column 容器 ----

  // 计算对齐修饰符（只在 flex 容器时才有 justify/align）
  const flexInfo = parseFlexFromClassNames(classNames);
  const merged   = mergeFlexFromCss(flexInfo, mergedStyle);
  const alignModifiers: string[] = [];

  // 只要 className 有 flex 或 CSS 里有 justify-content / align-items 就生成对齐修饰符
  if (flexInfo.isFlex || mergedStyle["justify-content"] || mergedStyle["align-items"]) {
    if (merged.justify && FLEX_ALIGN_MAP[merged.justify]) {
      alignModifiers.push(`${indent}.justifyContent(${FLEX_ALIGN_MAP[merged.justify]})`);
    }
    if (merged.align) {
      if (component === "Row" && VERTICAL_ALIGN_MAP[merged.align]) {
        alignModifiers.push(`${indent}.alignItems(${VERTICAL_ALIGN_MAP[merged.align]})`);
      } else if (component === "Column" && HORIZONTAL_ALIGN_MAP[merged.align]) {
        alignModifiers.push(`${indent}.alignItems(${HORIZONTAL_ALIGN_MAP[merged.align]})`);
      }
    }
  }

  const childrenArr = Array.isArray(node.children) ? node.children : [];
  const styles      = styleMapToArkUI(mergedStyle, indent);

  // ---- 检测是否有绝对定位子节点 → 用 Stack() 实现 CSS absolute 定位 ----
  const absChildren  = childrenArr.filter(c => typeof c !== "string" && isAbsoluteNode(c as DslNode)) as DslNode[];
  const normChildren = childrenArr.filter(c => typeof c !== "string" && !isAbsoluteNode(c as DslNode)) as DslNode[];

  // gap → Row/Column 构造参数 space（ArkUI 语法为 Row({ space: n })）
  const gapRaw = mergedStyle["gap"];
  const spaceParam = gapRaw
    ? `{ space: ${parsePositionValue(gapRaw.trim().split(/\s+/)[0])} }`
    : "";

  if (absChildren.length > 0) {
    // 普通子节点放进内层 Row/Column，绝对定位子节点携带 .position() 叠加在 Stack 里
    // Stack 使用 Alignment.TopStart，保持与 CSS position:relative 一致的坐标原点
    const innerIndent = "  ".repeat(depth + 1);

    // 内层容器对齐修饰符（缩进调整为 innerIndent）
    const innerAlignMods = alignModifiers.map(m => m.replace(indent, innerIndent));

    const innerChildLines = normChildren.map(c =>
      generateNode(c as DslNode, classStyleMap, depth + 2)
    );
    const innerContainerLines = normChildren.length > 0 ? [
      `${innerIndent}${component}(${spaceParam}) {`,
      ...innerChildLines,
      `${innerIndent}}`,
      // 内层容器必须撑满 Stack，否则 justifyContent/alignItems 无法生效
      `${innerIndent}.width("100%")`,
      `${innerIndent}.height("100%")`,
      ...innerAlignMods,
    ].filter(Boolean) : [];

    const absChildLines = absChildren.map(c => {
      const pos = getNodePosition(c as DslNode, classStyleMap);
      return generateNode(c as DslNode, classStyleMap, depth + 1, pos);
    });

    return [
      `${indent}Stack({ alignContent: Alignment.TopStart }) {`,
      ...innerContainerLines,
      ...absChildLines,
      `${indent}}`,
      styles,
    ].filter(Boolean).join("\n") + posSuffix;
  }

  // ---- 普通 Row / Column（无绝对定位子节点） ----
  const openTag  = `${indent}${component}(${spaceParam}) {`;
  const closeTag = `${indent}}`;

  const childLines: string[] = childrenArr.map(c =>
    generateNode(c as DslNode, classStyleMap, depth + 1)
  );

  return [openTag, ...childLines, closeTag, ...alignModifiers, styles]
    .filter(Boolean)
    .join("\n") + posSuffix;
}

// ---- 页面级生成 ----

function generatePage(page: DslPage): string {
  const classStyleMap = parseCss(page.css ?? "");
  const structName    = sanitizeName(page.fileName || "Page");

  // depth=3：build > Scroll > 内容根节点
  const bodyLines: string[] = [];
  if (Array.isArray(page.children)) {
    for (const child of page.children) {
      bodyLines.push(generateNode(child as DslNode, classStyleMap, 3));
    }
  }

  return [
    `@Entry`,
    `@Component`,
    `struct ${structName} {`,
    `  build() {`,
    `    Scroll() {`,
    ...bodyLines,
    `    }`,
    `  }`,
    `}`,
  ].join("\n");
}

// ---- 工具函数 ----

function escapeStr(s: string): string {
  return s
    .replace(/\r?\n|\r/g, "")   // 去掉换行符（\r\n / \n / \r）
    .replace(/\t/g, " ")        // tab → 空格
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_$&");
}

// ---- 入口 ----

export function generateArkUI(dsl: DslPage[]): string {
  return dsl.map(generatePage).join("\n\n");
}
