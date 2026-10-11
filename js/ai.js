/*
 * AI解説（Gemini API）
 *
 * 静的サイトなのでサーバーが無い。ブラウザから直接 API を呼ぶ。
 * API キーは自分のブラウザの localStorage にだけ保存する（単語一覧の設定から入力）。
 * 無料枠で使う前提なので、無料枠の回数が多い Flash-Lite を使う。
 * "-latest" は Google 側で最新版に自動で切り替わる別名。
 *
 * 生成した解説は単語データ（word.ai）に保存して、同じ単語で何度も API を叩かない。
 */
(function () {
  const MODEL = "gemini-flash-lite-latest";
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  // Gemini の responseSchema（OpenAPI 形式。additionalProperties は書けない）
  const SCHEMA = {
    type: "OBJECT",
    properties: {
      pos: { type: "STRING", description: "品詞（日本語。例：接続副詞、他動詞、名詞）" },
      meaning: { type: "STRING", description: "主な意味を読点区切りで2〜3個" },
      notes: { type: "STRING", description: "注意点。無ければ空文字" },
      examples: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { en: { type: "STRING" }, ja: { type: "STRING" } },
          required: ["en", "ja"],
        },
      },
    },
    required: ["pos", "meaning", "notes", "examples"],
    propertyOrdering: ["pos", "meaning", "notes", "examples"],
  };

  const SYSTEM = [
    "あなたは日本人の英語学習者向けに英単語を解説する先生です。",
    "学習者は単語帳で英単語と日本語訳を覚えています。登録された日本語訳の意味を中心に解説してください。",
    "notes には、意味の詳しい説明、似た単語との違い、使い方のクセ、間違えやすい点など、覚えるのに役立つことを2〜4文でまとめてください。特に無ければ空文字にします。",
    "examples は自然でよく使う例文を2つ。en は英文、ja はその自然な日本語訳です。",
  ].join("\n");

  function apiKey() {
    return (window.DF.Storage.getSettings().apiKey || "").trim();
  }
  function hasKey() {
    return !!apiKey();
  }

  async function call(text, generationConfig) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text }] }],
          generationConfig,
        }),
      });
    } catch (e) {
      throw new Error("通信できませんでした");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(describeError(res.status, data));

    if (data.promptFeedback && data.promptFeedback.blockReason) throw new Error("AI に回答を断られました");
    const cand = (data.candidates || [])[0];
    if (!cand) throw new Error("AI から返事がありませんでした");
    if (cand.finishReason === "SAFETY") throw new Error("AI に回答を断られました");
    const out = ((cand.content && cand.content.parts) || []).map((p) => p.text || "").join("");
    if (!out) throw new Error("AI から空の返事が返ってきました");
    return out;
  }

  function describeError(status, data) {
    const err = data.error || {};
    const reason = ((err.details || []).find((d) => d.reason) || {}).reason;
    if (reason === "API_KEY_INVALID" || status === 401) return "API キーが正しくありません";
    if (status === 403) return "この API キーでは使えません（キーの制限を確認してください）";
    if (status === 429) return "無料枠の回数を使い切りました。時間をおくか、明日もう一度";
    if (status >= 500) return "Gemini 側が混み合っています。少し待ってからもう一度";
    return `エラー（${status}）：${err.message || "不明なエラー"}`;
  }

  /* 単語 → { pos, meaning, notes, examples:[{en, ja}] } */
  async function explain(word) {
    const text = await call(`英単語：${word.word}\n単語帳に登録した日本語訳：${word.meaning}`, {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
    });
    return JSON.parse(text);
  }

  /* 追加の質問。毎回、前提（context）とそれまでの質疑を1つのメッセージにまとめて送る */
  async function chat(context, qa, question) {
    const past = (qa || []).map((x) => `Q. ${x.q}\nA. ${x.a}`).join("\n\n");
    const text = [
      context,
      past && `これまでの質問と回答：\n${past}`,
      `新しい質問：${question}`,
      "質問に日本語で、短く分かりやすく答えてください。見出しや箇条書きの記号、太字の記号は使わず、普通の文章で。",
    ]
      .filter(Boolean)
      .join("\n\n");
    return call(text);
  }

  /* 単語解説を踏まえた質問 */
  function ask(word, question) {
    const ai = word.ai || {};
    const context = [
      `英単語：${word.word}`,
      `単語帳に登録した日本語訳：${word.meaning}`,
      `これまでの解説：${JSON.stringify({ pos: ai.pos, meaning: ai.meaning, notes: ai.notes, examples: ai.examples })}`,
    ].join("\n");
    return chat(context, ai.qa, question);
  }

  const GRADE_SCHEMA = {
    type: "OBJECT",
    properties: {
      correct: { type: "BOOLEAN", description: "正解なら true" },
      corrected: { type: "STRING", description: "学習者の英文のスペルミスだけを直したもの。それ以外は一字一句そのまま" },
      comment: { type: "STRING", description: "日本語で一言（1文）のコメント" },
    },
    required: ["correct", "corrected", "comment"],
    propertyOrdering: ["correct", "corrected", "comment"],
  };

  /* 文章翻訳の採点 → { correct, corrected, comment } */
  async function grade(word, ja, en, answer) {
    const text = [
      "日本語の文を英語に訳すテストを採点してください。",
      `テストしている英単語：${word.word}（${word.meaning}）`,
      `問題（日本語）：${ja}`,
      `模範解答の一例：${en}`,
      `学習者の解答：${answer}`,
      "",
      "採点のルール：",
      "- 多少のスペルミス（タイプミス）は減点しない。corrected にはスペルミスだけを直した学習者の英文を入れる。語順・単語の選び方・文法は直さず、学習者が書いたまま残す",
      "- 問題文と意味の単位で違うこと（抜けている、余計な内容がある、別の意味になっている）を書いていたら不正解",
      "- テストしている英単語（活用形は可）を使っていなければ不正解",
      "- 冠詞や単数・複数など、意味が変わらない細かい文法の誤りは正解のままにして、comment で指摘する",
      "- 模範解答と言い回しが違っても、意味が同じなら正解",
      "- comment は日本語で一言。正解なら良い点か直すと良くなる点、不正解なら何が違うか",
    ].join("\n");
    const out = await call(text, { responseMimeType: "application/json", responseSchema: GRADE_SCHEMA });
    return JSON.parse(out);
  }

  window.DF = window.DF || {};
  window.DF.AI = { hasKey, explain, ask, chat, grade };
})();
