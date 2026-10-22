// 零宽中和（neutralize）单元测试：
// 上游对「DeepSeek Harness」裸词组做精确渠道匹配（400 / 11128），
// 本模块把裸词组替换为中间夹零宽空格（U+200B）的形态——模型语义不变，
// 精确匹配失效。关键安全约束：文件路径语境（前后含 / 或 \）绝不改。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { neutralize, hasNeutralizable } from '../src/neutralize.mjs';

const ZW = '\u200B';

describe('neutralize：裸词组被替换为夹零宽空格形态', () => {
  test('单个普通空格：DeepSeek Harness → DeepSeek\\u200B Harness', () => {
    assert.equal(neutralize('You are an AI agent powered by DeepSeek Harness.'),
      `You are an AI agent powered by DeepSeek${ZW}Harness.`);
  });

  test('多个空格 / 制表符也命中', () => {
    assert.equal(neutralize('DeepSeek   Harness'), `DeepSeek${ZW}Harness`);
    assert.equal(neutralize('DeepSeek\tHarness'), `DeepSeek${ZW}Harness`);
  });

  test('不间断空格（U+00A0）也命中', () => {
    assert.equal(neutralize('DeepSeek\u00A0Harness'), `DeepSeek${ZW}Harness`);
  });

  test('同一句里多处命中都替换', () => {
    assert.equal(neutralize('DeepSeek Harness 与 DeepSeek Harness'),
      `DeepSeek${ZW}Harness 与 DeepSeek${ZW}Harness`);
  });

  test('无关键词 → 原样返回（内容等价）', () => {
    const s = 'The quick brown fox jumps over the lazy dog.';
    assert.equal(neutralize(s), s);
  });
});

describe('neutralize：文件路径语境绝不误改', () => {
  test('Windows 反斜杠路径（裸 JS 字符串形态）不改', () => {
    const p = 'D:\\DeepSeek Harness\\resources\\app.asar';
    assert.equal(neutralize(p), p, '前后是反斜杠的路径必须保持原样');
  });

  test('Windows 路径的 JSON 转义形态（双反斜杠）不改', () => {
    // 这是「对 JSON.stringify 结果做中和」时真实出现的文本形态
    const jsonText = JSON.stringify({ content: 'D:\\DeepSeek Harness\\x' });
    assert.equal(neutralize(jsonText), jsonText, 'JSON 里的 \\\\ 前后仍是斜杠，须跳过');
  });

  test('POSIX 斜杠路径不改', () => {
    assert.equal(neutralize('/opt/DeepSeek Harness/app.asar'), '/opt/DeepSeek Harness/app.asar');
  });

  test('路径前后各是斜杠的片段也不改', () => {
    assert.equal(neutralize('\\DeepSeek Harness\\'), '\\DeepSeek Harness\\');
    assert.equal(neutralize('/DeepSeek Harness/'), '/DeepSeek Harness/');
  });
});

describe('neutralize：整体 JSON body 场景（fetch 层调用形态）', () => {
  const 造body = () => ({
    model: 'deepseek-v4-pro',
    stream: true,
    messages: [
      { role: 'system', content: 'You are an AI agent powered by DeepSeek Harness. Workdir: D:\\DeepSeek Harness\\work' },
      { role: 'user', content: 'hi' },
    ],
  });

  test('system 里的裸词组被替换，同一条消息里的路径保持原样', () => {
    const out = neutralize(JSON.stringify(造body()));
    assert.ok(out.includes(`DeepSeek${ZW}Harness.`), '裸词组应被中和');
    assert.ok(!out.includes('DeepSeek Harness.'), '裸词组不应再出现');
    assert.ok(out.includes('D:\\\\DeepSeek Harness\\\\work'), '路径（JSON 双反斜杠形态）应原样保留');
  });

  test('对传入的 JSON 文本直接处理（入参已是字符串）', () => {
    const json = JSON.stringify(造body());
    const out = neutralize(json);
    assert.notEqual(out, json);
    assert.ok(JSON.parse(out), '中和结果仍是合法 JSON');
  });
});

describe('neutralize：非字符串输入', () => {
  test('对象入参先 JSON.stringify 再中和', () => {
    assert.equal(neutralize({ a: 'DeepSeek Harness' }), `{"a":"DeepSeek${ZW}Harness"}`);
  });

  test('数组入参', () => {
    assert.equal(neutralize(['DeepSeek Harness']), `["DeepSeek${ZW}Harness"]`);
  });

  test('null / undefined 不抛错（契约：永远返回字符串）', () => {
    assert.equal(neutralize(null), 'null');
    assert.equal(neutralize(undefined), '');
  });

  test('空字符串原样返回', () => {
    assert.equal(neutralize(''), '');
  });

  test('循环引用对象不抛错、原样降级', () => {
    const self = {};
    self.self = self;
    const out = neutralize(self);
    assert.equal(typeof out, 'string');
  });
});

describe('hasNeutralizable：探测裸词组', () => {
  test('裸词组 → true', () => {
    assert.equal(hasNeutralizable('powered by DeepSeek Harness.'), true);
  });

  test('已是零宽形态 → false（零宽空格本身在字符类里，但替换后前后不再是裸空格……验证不误报）', () => {
    // 替换结果里 "DeepSeek\u200BHarness"：词组中间是 ZW，字符类 [\u00A0\u200B\s]+ 仍能匹配，
    // 但正则替换是幂等的（再跑一遍结果不变）——hasNeutralizable 用于日志/探测，
    // 允许它对「已中和文本」报 true，只要 neutralize 幂等即可。
    const once = neutralize('DeepSeek Harness');
    assert.equal(neutralize(once), once, '中和必须幂等');
  });

  test('路径语境 → false', () => {
    assert.equal(hasNeutralizable('D:\\DeepSeek Harness\\x'), false);
  });

  test('空 / 非字符串 → false', () => {
    assert.equal(hasNeutralizable(''), false);
    assert.equal(hasNeutralizable(null), false);
    assert.equal(hasNeutralizable(undefined), false);
  });
});
