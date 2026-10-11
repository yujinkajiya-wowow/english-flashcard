/*
 * AI解説（Claude API）
 *
 * 静的サイトなのでサーバーが無い。ブラウザから直接 API を呼ぶ。
 * API キーは自分のブラウザの localStorage にだけ保存する（単語一覧の設定から入力）。
 * SDK は vendor/ に1ファイルにまとめたものを、初めて使うときに読み込む。
 *
 * 生成した解説は単語データ（word.ai）に保存して、同じ単語で何度も API を叩かない。
 */
(function () {
  const SDK_SRC = "vendor/anthropic-sdk-0.128.0.js";
  const MODEL = "claude-opus-5-5";

  const SCHEMA = {
    type: "object",
    properties: {
      pos: { type: "string", description: "品詞（日本語。例：接続副詞、他動詞、名詞）" },
      meaning: { type: "string", description: "主な意味を読点区切りで2〜3個" },
      notes: { type: "string", description: "注意点。無ければ空文字" },
      examples: {
        type: "array",
        items: {
          type: "object",
          properties: { en: { type: "string" }, ja: { type: "string" } },
          required: ["en", "ja"],
          additionalProperties: false,
        },
      },
    },
    required: ["pos", "meaning", "notes", "examples"],
    additionalProperties: false,
  };

  const SYSTEM = [
    "あなたは日本人の英語学習者向けに英単語を解説する先生です。",
    "学習者は単語帳で英単語と日本語訳を覚えています。登録された日本語訳の意味を中心に解説してください。",
    "notes には、意味の詳しい説明、似た単語との違い、使い方のクセ、間違えやすい点など、覚えるのに役立つことを2〜4文でまとめてください。特に無ければ空文字にします。",
    "examples は自然でよく使う例文を2つ。en は英文、ja はその自然な日本語訳です。",
  ].join("\n");

  let sdk = null;
  function loadSdk() {
    if (sdk) return sdk;
    sdk = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SDK_SRC;
      s.onload = () => resolve(window.Anthropic);
      s.onerror = () => {
        sdk = null;
        reject(new Error("SDK の読み込みに失敗しました"));
      };
      document.head.appendChild(s);
    });
    return sdk;
  }

  function apiKey() {
    return (window.DF.Storage.getSettings().apiKey || "").trim();
  }
  function hasKey() {
    return !!apiKey();
  }

  async function call(params) {
    const Anthropic = await loadSdk();
    const client = new Anthropic({ apiKey: apiKey(), dangerouslyAllowBrowser: true });
    let res;
    try {
      res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // 単語の解説はそこまで考え込まなくていいので速さ優先
        output_config: Object.assign({ effort: "low" }, params.output_config),
        // 安全フィルタに誤って止められたときは、API 側で別のモデルに切り替えて続ける
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        messages: params.messages,
      });
    } catch (e) {
      throw new Error(describeError(Anthropic, e));
    }
    if (res.stop_reason === "refusal") throw new Error("AI に回答を断られました");
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text) throw new Error("AI から空の返事が返ってきました");
    return text;
  }

  function describeError(Anthropic, e) {
    if (e instanceof Anthropic.AuthenticationError) return "API キーが正しくありません";
    if (e instanceof Anthropic.PermissionDeniedError) return "この API キーではこのモデルを使えません";
    if (e instanceof Anthropic.RateLimitError) return "混み合っています。少し待ってからもう一度";
    if (e instanceof Anthropic.APIConnectionError) return "通信できませんでした";
    if (e instanceof Anthropic.APIError) return `エラー（${e.status}）：${e.message}`;
    return e.message || String(e);
  }

  /* 単語 → { pos, meaning, notes, examples:[{en, ja}] } */
  async function explain(word) {
    const text = await call({
      messages: [
        {
          role: "user",
          content: `英単語：${word.word}\n単語帳に登録した日本語訳：${word.meaning}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    return JSON.parse(text);
  }

  /* 解説を踏まえた追加の質問。毎回、それまでの内容を1つのメッセージにまとめて送る */
  async function ask(word, question) {
    const ai = word.ai || {};
    const past = (ai.qa || []).map((x) => `Q. ${x.q}\nA. ${x.a}`).join("\n\n");
    const content = [
      `英単語：${word.word}`,
      `単語帳に登録した日本語訳：${word.meaning}`,
      `これまでの解説：${JSON.stringify({ pos: ai.pos, meaning: ai.meaning, notes: ai.notes, examples: ai.examples })}`,
      past && `これまでの質問と回答：\n${past}`,
      `新しい質問：${question}`,
      "質問に日本語で、短く分かりやすく答えてください。見出しや箇条書きの記号は使わず、普通の文章で。",
    ]
      .filter(Boolean)
      .join("\n\n");
    return call({ messages: [{ role: "user", content }] });
  }

  window.DF = window.DF || {};
  window.DF.AI = { hasKey, explain, ask };
})();
