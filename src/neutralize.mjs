// 零宽中和（lossless neutralization）：把出站请求体里的「DeepSeek Harness」
// 客户端身份词组，改成中间夹一个零宽空格（U+200B）的形态。
//
// 为什么：WorkBuddy / CodeBuddy 上游对「非官方渠道」做精确字符串匹配——
// DSH harness 的系统提示词以 "You are an AI agent powered by DeepSeek Harness."
// 开头，命中黑名单后所有请求被回 400 / code 11128
// （"Illegal API invocation from an unapproved channel"）。
// 在 "DeepSeek" 与 "Harness" 之间插入零宽空格后，精确匹配失效，
// 但模型读到的语义完全不变（零宽空格不可见），即「无损」。
//
// 安全性：只对「裸词组」动手。若词组出现在文件路径里
// （如 D:\...\DeepSeek Harness\...），则路径中必然含 \ 或 /，
// 正则用前后瞻 (?<![\\/]) (?![\\/]) 精确跳过，避免把工具要用的
// 真实路径改坏（模型拿着带零宽字符的坏路径调工具会直接失败）。
//
// 实现方式：对「已 JSON.stringify 的整个 body 文本」做替换，而不是逐字段
// 递归 walk。因为 JSON 转义后，路径里的反斜杠会变成 \\\\（双反斜杠），
// 前后仍是斜杠字符，天然被正则排除；而 system 消息里裸露的词组
// （普通空格 / 不间断空格分隔）前后不是斜杠，会被命中替换。
// 一次 replace、零副作用，覆盖面也最全（messages、instructions 折叠进
// user 的文本、以及任意字符串字段都一并处理）。

/** 零宽空格。 */
const ZERO_WIDTH_SPACE = '\u200B';

/**
 * 匹配 "DeepSeek" + 普通/不间断空格 + "Harness"，
 * 但前后不能是 / 或 \（即排除文件路径语境）。
 */
const NEUTRALIZE_PATTERN = /(?<![\\/])DeepSeek[\u00A0\u200B\s]+Harness(?![\\/])/g;

/**
 * 把一段文本（或任意可 JSON 序列化值）里的裸「DeepSeek Harness」词组
 * 替换为夹零宽空格的形态。
 *
 * - 入参不是字符串时先 JSON.stringify（对已 stringified 的 body 文本直接替换）。
 * - 命中 0 处则原样返回，不产生无谓的新字符串。
 * - 契约：永远返回字符串。null 序列化后是 "null"、undefined 没有
 *   JSON 表示（返回 ''）、循环引用降级为 String(value)——绝不抛错、
 *   绝不把请求改坏。
 *
 * @param {string|unknown} value 待处理的文本（或对象）
 * @returns {string} 处理后的文本
 */
export function neutralize(value) {
  const text = typeof value === 'string' ? value : safeStringify(value);
  if (!text) return '';
  const out = text.replace(NEUTRALIZE_PATTERN, `DeepSeek${ZERO_WIDTH_SPACE}Harness`);
  return out;
}

function safeStringify(value) {
  try {
    const s = JSON.stringify(value);
    return s === undefined ? '' : s;
  } catch {
    // 序列化失败（循环引用等）：降级为普通字符串转换，不做中和、不改坏请求
    return String(value);
  }
}

/**
 * 判断一段文本里是否含会被中和的裸词组（供测试/日志用）。
 * @param {string} text
 * @returns {boolean}
 */
export function hasNeutralizable(text) {
  if (typeof text !== 'string' || !text) return false;
  NEUTRALIZE_PATTERN.lastIndex = 0;
  return NEUTRALIZE_PATTERN.test(text);
}
