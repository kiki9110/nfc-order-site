// ============================================================
// NFC ORDER — Cloudflare Worker （全機能統合版）
// Cloudflare ダッシュボード → Edit code → 全文貼り付け
// ============================================================

// 管理者パスワードは Cloudflare の環境変数（シークレット）ADMIN_PASSWORD から読み込む。
// ★設定方法：Cloudflare ダッシュボード → Workers & Pages → 対象Worker → Settings →
//   Variables and Secrets → Add →  Type: Secret / Name: ADMIN_PASSWORD / Value: 任意の長い文字列。
//   （ローカル開発で wrangler を使う場合は .dev.vars に ADMIN_PASSWORD=... を置く）
// ※ Code.gs 側の CONFIG.ADMIN_PASSWORD と同じ文字列にすること。
//
// 値が未設定のときは「絶対に一致しないトークン」を返し、全リクエストを拒否する
// （シークレットの設定漏れで無認証のまま開いてしまう事故を防ぐため）。
function adminBearer(env) {
  return (env && env.ADMIN_PASSWORD) ? 'Bearer ' + env.ADMIN_PASSWORD : '\x00disabled';
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const origin = url.origin;

    // ── CORS ヘッダー（全エンドポイント共通）──
    const cors = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const htmlHdr = { 'Content-Type': 'text/html;charset=UTF-8' };

    // ── お客さん向けマイページ（NFC・QR 共通の変更サイト）──
    if (path === '/portal' || path === '/portal/' || path === '/my' || path === '/my/')
      return new Response(portalHTML(origin), { headers: htmlHdr });

    // ── NFC / QR リダイレクト ──
    if (path.startsWith('/nfc/'))      return handleNFC(path, env, origin);
    if (path.startsWith('/qr/'))       return handleQR(path, env, origin);

    // ── 旧設定ページURL → マイページへリダイレクト（後方互換）──
    if (path.startsWith('/setup/'))    return Response.redirect(origin + '/portal?add=' + encodeURIComponent(path.replace('/setup/', '').trim()), 302);
    if (path.startsWith('/setup-qr/')) return Response.redirect(origin + '/portal?add=' + encodeURIComponent(path.replace('/setup-qr/', '').trim()), 302);

    // ── 注文詳細ページ（管理者）──
    if (path.startsWith('/order/'))    return handleOrderDetail(path, request, env, origin);

    // ── お客さん向け API（認証不要・注文番号が鍵）──
    if (path === '/api/customer-get')      return handleCustomerGet(request, env, cors);
    if (path === '/api/customer-set-all')  return handleCustomerSetAll(request, env, cors);
    if (path === '/api/customer-set')      return handleCustomerSet(request, env, cors);
    if (path === '/api/customer-set-qr')   return handleCustomerSetQR(request, env, cors);

    // ── オプション在庫（オプション単体注文の管理）──
    if (path === '/api/opt-get')           return handleOptGet(request, env, cors);      // 公開：状態確認
    if (path === '/api/opt-apply')         return handleOptApply(request, env, cors);    // 公開：page4で本体に紐付け
    if (path === '/api/opt-register')      return handleOptRegister(request, env, cors); // 管理者：Code.gsが登録
    if (path === '/api/opt-list')          return handleOptList(request, env, cors);     // 管理者：一覧
    if (path === '/api/opt-set-used')      return handleOptSetUsed(request, env, cors);  // 管理者：使用済み切替

    // ── 在庫・メンテナンス（公開・認証不要）──
    if (path === '/api/get-inventory')     return handleGetInventory(request, env, cors);

    // ── 自己登録ページ（URLを知る人のみ）──
    if (path === '/api/self-register')     return handleSelfRegister(request, env, cors);  // 公開：番号を自己登録
    if (path === '/api/self-opt-get')      return handleSelfOptGet(request, env, cors);    // 公開：デフォルト設定取得
    if (path === '/api/self-opt-set')      return handleSelfOptSet(request, env, cors);    // 管理者：デフォルト設定保存

    // ── 管理者向け API（要パスワード）──
    if (path === '/admin' || path === '/admin/') return new Response(adminHTML(origin), { headers: htmlHdr });
    if (path === '/api/set')               return handleSet(request, env, cors);
    if (path === '/api/set-all')           return handleSetAll(request, env, cors);
    if (path === '/api/set-qr')            return handleSetQR(request, env, cors);
    if (path === '/api/get')               return handleGet(request, env, cors);
    if (path === '/api/get-all')           return handleGetAll(request, env, cors);
    if (path === '/api/get-qr-url')        return handleGetQRUrl(request, env, cors);
    if (path === '/api/delete')            return handleDelete(request, env, cors);
    if (path === '/api/register')          return handleRegister(request, env, cors);
    if (path === '/api/save-order')        return handleSaveOrder(request, env, cors);
    if (path === '/api/get-order')         return handleGetOrder(request, env, cors);
    if (path === '/api/inventory')         return handleInventory(request, env, cors);
    if (path === '/api/export')            return handleExport(request, env, cors);
    if (path === '/api/import')            return handleImport(request, env, cors);

    // ── メッセージ（お問い合わせ）──
    if (path === '/api/message')        return handleMessageCreate(request, env, cors); // 公開：フォーム送信
    if (path === '/api/messages')       return handleMessageList(request, env, cors);   // 管理者：一覧
    if (path === '/api/message-update') return handleMessageUpdate(request, env, cors);  // 管理者：既読/削除/通知済み

    // ── サポート（チケット＋チャット）──
    if (path === '/support' || path === '/support/') return new Response(supportListHTML(origin), { headers: htmlHdr }); // 本人のサポート一覧
    if (path === '/support/new')                     return new Response(supportNewHTML(origin),  { headers: htmlHdr }); // 新規作成
    if (path.startsWith('/support/'))                return new Response(supportChatHTML(origin), { headers: htmlHdr }); // 番号別チャット
    if (path === '/api/support-create')  return handleSupportCreate(request, env, cors);  // 公開：作成 → 6桁番号
    if (path === '/api/support-get')     return handleSupportGet(request, env, cors);     // 公開：番号で取得（チャット）
    if (path === '/api/support-message') return handleSupportMessage(request, env, cors); // 公開：本人がメッセージ追加
    if (path === '/api/support-list')    return handleSupportList(request, env, cors);    // 管理者：一覧
    if (path === '/api/support-reply')   return handleSupportReply(request, env, cors);   // 管理者：返信
    if (path === '/api/support-update')  return handleSupportUpdate(request, env, cors);  // 管理者：状態/通知済み/自動解決

    return new Response('NFC Order Worker ✓');
  }
};


// ═══════════════════════════════════════════════
// NFC / QR リダイレクト処理
// ═══════════════════════════════════════════════

// NFCタグにタッチ → 登録済みURLへリダイレクト
async function handleNFC(path, env, origin) {
  const orderId = path.replace('/nfc/', '').trim();
  if (!orderId) return new Response('注文番号が指定されていません', { status: 400 });

  const stored = await env.NFC_URLS.get(orderId);
  if (!stored) return Response.redirect(origin + '/portal?add=' + encodeURIComponent(orderId), 302);

  const data = JSON.parse(stored);
  if (!data.url) return Response.redirect(origin + '/portal?add=' + encodeURIComponent(orderId), 302);

  // アクセス数・最終アクセス日時を記録
  data.accessCount = (data.accessCount || 0) + 1;
  data.lastAccess  = new Date().toISOString();
  await env.NFC_URLS.put(orderId, JSON.stringify(data));
  return Response.redirect(data.url, 302);
}

// QRコードスキャン → 登録済みURLへリダイレクト
async function handleQR(path, env, origin) {
  const orderId = path.replace('/qr/', '').trim();
  if (!orderId) return new Response('注文番号が指定されていません', { status: 400 });

  const stored = await env.NFC_URLS.get('QR:' + orderId);
  if (!stored) return Response.redirect(origin + '/portal?add=' + encodeURIComponent(orderId), 302);

  const data = JSON.parse(stored);
  if (!data.url) return Response.redirect(origin + '/portal?add=' + encodeURIComponent(orderId), 302);

  // アクセス数・最終アクセス日時を記録
  data.accessCount = (data.accessCount || 0) + 1;
  data.lastAccess  = new Date().toISOString();
  await env.NFC_URLS.put('QR:' + orderId, JSON.stringify(data));
  return Response.redirect(data.url, 302);
}


// ═══════════════════════════════════════════════
// お客さん向け API（認証不要）
// ═══════════════════════════════════════════════

// 注文番号から現在の NFC / QR URL を取得（マイページ表示用）
async function handleCustomerGet(request, env, cors) {
  const url     = new URL(request.url);
  const orderId = (url.searchParams.get('orderId') || '').trim();
  if (!orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  const nfcRaw = await env.NFC_URLS.get(orderId);
  if (!nfcRaw) return json({ exists: false }, 200, cors); // 未登録の注文番号

  const nfc   = JSON.parse(nfcRaw);
  const qrRaw = await env.NFC_URLS.get('QR:' + orderId);
  const qr    = qrRaw ? JSON.parse(qrRaw) : null;

  return json({
    exists:  true,
    orderId,
    label:   nfc.label || '',
    nfcUrl:  nfc.url   || '',
    hasQr:   !!qr,
    qrUrl:   qr ? (qr.url || '') : '',
    // 購入オプションと追加枚数（page2 でロック判定に使う）
    options:    { ...(nfc.options || {}), diecut: true }, // ダイカットは標準仕様（誰でも選べる）
    addonCount: nfc.addonCount || 0,
  }, 200, cors);
}

// ───── 自己登録ページ（友人・知人向け／URLを知る人だけ）─────
// 好きな10桁の数字を自分で決めて登録。名前は label（＝管理画面のメモ欄）に保存。
// オプションは「登録した時点の SELF_OPT 設定」を焼き付ける。
// → 後から管理画面で設定を変えても、すでに登録済みの番号のオプションは変わらない。
async function handleSelfRegister(request, env, cors) {
  const body    = await request.json();
  const orderId = (body.orderId || '').trim();
  const name    = (body.name    || '').trim();
  if (!/^[0-9]{10}$/.test(orderId)) return json({ error: 'invalid', message: '10桁の数字で入力してください' }, 400, cors);
  const exist = await env.NFC_URLS.get(orderId);
  if (exist) return json({ error: 'used', message: 'この番号はもう使われています' }, 409, cors);
  // 登録時点のデフォルトオプションを読み取って焼き付け
  const optRaw = await env.NFC_URLS.get('SELF_OPT');
  const defOpt = optRaw ? JSON.parse(optRaw) : { nfc: false, double: false };
  const now = new Date().toISOString();
  await env.NFC_URLS.put(orderId, JSON.stringify({
    orderId, url: '', label: name, history: [],
    registeredAt: now, updatedAt: now, accessCount: 0, lastAccess: null,
    options:    { nfc: !!defOpt.nfc, double: !!defOpt.double, diecut: true },
    addonCount: 0, selfRegistered: true, submittedAt: now,
  }));
  return json({ ok: true, orderId }, 200, cors);
}
// 自己登録のデフォルトオプション設定を取得（管理画面が現在値を表示するため・公開）
async function handleSelfOptGet(request, env, cors) {
  const raw = await env.NFC_URLS.get('SELF_OPT');
  const opt = raw ? JSON.parse(raw) : { nfc: false, double: false };
  return json({ options: opt }, 200, cors);
}
// 自己登録のデフォルトオプション設定を保存（管理者のみ）
async function handleSelfOptSet(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);
  const body = await request.json();
  const opt = { nfc: !!body.nfc, double: !!body.double };
  await env.NFC_URLS.put('SELF_OPT', JSON.stringify(opt));
  return json({ ok: true, options: opt }, 200, cors);
}

// NFC / QR URL をまとめて変更（マイページの保存ボタン）
// body に nfcUrl があれば NFC を、qrUrl があれば QR を更新（片方だけも可）
async function handleCustomerSetAll(request, env, cors) {
  const body    = await request.json();
  const orderId = (body.orderId || '').trim();
  if (!orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  const nfcRaw = await env.NFC_URLS.get(orderId);
  if (!nfcRaw) return json({ error: '注文番号が見つかりません' }, 404, cors);

  let changed = false;

  // NFC URL を更新（body に nfcUrl キーがある時だけ）
  if (Object.prototype.hasOwnProperty.call(body, 'nfcUrl')) {
    const nfc = JSON.parse(nfcRaw);
    pushHistory(nfc, body.nfcUrl);
    nfc.url       = body.nfcUrl;
    nfc.updatedAt = new Date().toISOString();
    await env.NFC_URLS.put(orderId, JSON.stringify(nfc));
    changed = true;
  }

  // QR URL を更新（body に qrUrl キーがある時だけ）
  if (Object.prototype.hasOwnProperty.call(body, 'qrUrl')) {
    const qrRaw = await env.NFC_URLS.get('QR:' + orderId);
    const qr = qrRaw ? JSON.parse(qrRaw) : {
      orderId, url: '', history: [],
      registeredAt: new Date().toISOString(), accessCount: 0, lastAccess: null,
    };
    pushHistory(qr, body.qrUrl);
    qr.url       = body.qrUrl;
    qr.updatedAt = new Date().toISOString();
    await env.NFC_URLS.put('QR:' + orderId, JSON.stringify(qr));
    changed = true;
  }

  if (!changed) return json({ error: '変更する項目がありません' }, 400, cors);
  return json({ ok: true }, 200, cors);
}

// NFC URL を単体で保存（旧エンドポイント・後方互換）
async function handleCustomerSet(request, env, cors) {
  const body = await request.json();
  if (!body.orderId || !body.url) return json({ error: 'orderId と url が必要です' }, 400, cors);

  const stored = await env.NFC_URLS.get(body.orderId);
  if (!stored) return json({ error: '注文番号が見つかりません' }, 404, cors);

  const data = JSON.parse(stored);
  pushHistory(data, body.url);
  data.url       = body.url;
  data.updatedAt = new Date().toISOString();
  await env.NFC_URLS.put(body.orderId, JSON.stringify(data));
  return json({ ok: true }, 200, cors);
}

// QR URL を単体で保存（旧エンドポイント・後方互換）
async function handleCustomerSetQR(request, env, cors) {
  const body = await request.json();
  if (!body.orderId || !body.url) return json({ error: 'orderId と url が必要です' }, 400, cors);

  const stored = await env.NFC_URLS.get('QR:' + body.orderId);
  if (!stored) return json({ error: '注文番号が見つかりません' }, 404, cors);

  const data = JSON.parse(stored);
  pushHistory(data, body.url);
  data.url       = body.url;
  data.updatedAt = new Date().toISOString();
  await env.NFC_URLS.put('QR:' + body.orderId, JSON.stringify(data));
  return json({ ok: true }, 200, cors);
}


// ═══════════════════════════════════════════════
// 管理者向け API（要パスワード）
// ═══════════════════════════════════════════════

// NFC URL を登録・更新
async function handleSet(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const body = await request.json();
  if (!body.orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  const existing = await env.NFC_URLS.get(body.orderId);
  const prev     = existing ? JSON.parse(existing) : {};
  pushHistory(prev, body.url);
  const record = {
    orderId:      body.orderId,
    url:          body.url || '',
    label:        body.label || '',
    history:      prev.history || [],
    registeredAt: prev.registeredAt || new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    accessCount:  prev.accessCount  || 0,
    lastAccess:   prev.lastAccess   || null,
  };
  await env.NFC_URLS.put(body.orderId, JSON.stringify(record));
  return json({ ok: true, record }, 200, cors);
}

// NFC / QR / メモをまとめて更新（管理画面の編集モーダルから）
async function handleSetAll(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const body    = await request.json();
  const orderId = (body.orderId || '').trim();
  if (!orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  // NFC レコードを更新
  const nfcRaw = await env.NFC_URLS.get(orderId);
  const nfc = nfcRaw ? JSON.parse(nfcRaw) : {
    orderId, url: '', label: '', history: [],
    registeredAt: new Date().toISOString(), accessCount: 0, lastAccess: null,
  };
  if (Object.prototype.hasOwnProperty.call(body, 'nfcUrl')) {
    pushHistory(nfc, body.nfcUrl);
    nfc.url       = body.nfcUrl;
    nfc.updatedAt = new Date().toISOString();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'label')) {
    nfc.label = body.label;
  }
  // 購入オプションの手動更新（管理画面の編集モーダルから）
  // ここで変更すると page2 側のロック状態も連動する。
  if (Object.prototype.hasOwnProperty.call(body, 'options')) {
    nfc.options = body.options || {};
  }
  // 2枚目以降の追加枚数の手動更新
  if (Object.prototype.hasOwnProperty.call(body, 'addonCount')) {
    nfc.addonCount = parseInt(body.addonCount, 10) || 0;
  }
  await env.NFC_URLS.put(orderId, JSON.stringify(nfc));

  // QR レコードを更新
  if (Object.prototype.hasOwnProperty.call(body, 'qrUrl')) {
    const qrRaw = await env.NFC_URLS.get('QR:' + orderId);
    const qr = qrRaw ? JSON.parse(qrRaw) : {
      orderId, url: '', history: [],
      registeredAt: new Date().toISOString(), accessCount: 0, lastAccess: null,
    };
    pushHistory(qr, body.qrUrl);
    qr.url       = body.qrUrl;
    qr.updatedAt = new Date().toISOString();
    await env.NFC_URLS.put('QR:' + orderId, JSON.stringify(qr));
  }

  return json({ ok: true }, 200, cors);
}

// QR URL を登録・更新（単体）
async function handleSetQR(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const body = await request.json();
  if (!body.orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  const existing = await env.NFC_URLS.get('QR:' + body.orderId);
  const prev     = existing ? JSON.parse(existing) : {};
  pushHistory(prev, body.url || '');
  const record = {
    orderId:      body.orderId,
    url:          body.url || '',
    history:      prev.history || [],
    registeredAt: prev.registeredAt || new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    accessCount:  prev.accessCount  || 0,
    lastAccess:   prev.lastAccess   || null,
  };
  await env.NFC_URLS.put('QR:' + body.orderId, JSON.stringify(record));
  return json({ ok: true }, 200, cors);
}

// NFC 一覧を取得（旧エンドポイント・後方互換）
async function handleGet(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const list    = await env.NFC_URLS.list();
  const nfcKeys = list.keys.filter(k => !k.name.startsWith('QR:') && !k.name.startsWith('ORDER:') && !k.name.startsWith('OPT:') && k.name !== 'INVENTORY');
  const items   = await Promise.all(
    nfcKeys.map(async k => {
      const v = await env.NFC_URLS.get(k.name);
      return v ? JSON.parse(v) : null;
    })
  );
  return json({ items: items.filter(Boolean) }, 200, cors);
}

// NFC・QR・注文をまとめた一覧を取得（管理画面の新しい一覧用）
async function handleGetAll(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const allKeys = await listAllKeys(env);
  const nfcKeys = allKeys.filter(k => !k.name.startsWith('QR:') && !k.name.startsWith('ORDER:') && !k.name.startsWith('OPT:') && k.name !== 'INVENTORY');

  const items = await Promise.all(nfcKeys.map(async k => {
    const orderId = k.name;
    const nfcRaw  = await env.NFC_URLS.get(orderId);
    const qrRaw   = await env.NFC_URLS.get('QR:' + orderId);
    const ordRaw  = await env.NFC_URLS.get('ORDER:' + orderId);
    const nfc = nfcRaw ? JSON.parse(nfcRaw) : {};
    const qr  = qrRaw  ? JSON.parse(qrRaw)  : {};

    // 最終URL更新日時（NFC/QRで新しい方）→ 更新日順ソートに使う
    const times = [nfc.updatedAt, qr.updatedAt].filter(Boolean).map(t => new Date(t).getTime());
    const lastUrlUpdate = times.length
      ? new Date(Math.max(...times)).toISOString()
      : (nfc.registeredAt || null);

    return {
      orderId,
      label:         nfc.label       || '',
      registeredAt:  nfc.registeredAt || null,
      nfcUrl:        nfc.url          || '',
      nfcUpdatedAt:  nfc.updatedAt    || null,
      nfcHistory:    nfc.history      || [],
      accessCount:   nfc.accessCount  || 0,
      lastAccess:    nfc.lastAccess   || null,
      qrUrl:         qr.url           || '',
      qrUpdatedAt:   qr.updatedAt     || null,
      qrHistory:     qr.history       || [],
      qrAccessCount: qr.accessCount   || 0,
      hasOrder:      !!ordRaw,
      lastUrlUpdate,
      // 購入オプションと追加枚数（管理画面で手動編集できるようにする）
      options:       nfc.options      || {},
      addonCount:    nfc.addonCount   || 0,
    };
  }));

  return json({ items }, 200, cors);
}

// QR URL を単体取得（後方互換）
async function handleGetQRUrl(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const url     = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) return json({ url: '' }, 200, cors);

  const stored = await env.NFC_URLS.get('QR:' + orderId);
  if (!stored) return json({ url: '' }, 200, cors);
  return json({ url: JSON.parse(stored).url || '' }, 200, cors);
}

// 削除（NFC・QR・注文データをまとめて削除）
async function handleDelete(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const { orderId } = await request.json();
  if (!orderId) return json({ error: 'orderId が必要です' }, 400, cors);
  await env.NFC_URLS.delete(orderId);
  await env.NFC_URLS.delete('QR:'    + orderId);
  await env.NFC_URLS.delete('ORDER:' + orderId);
  return json({ ok: true }, 200, cors);
}

// Apps Script から注文送信時に自動登録
async function handleRegister(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const body = await request.json();
  if (!body.orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  // 既存のNFC・QRレコードを読み込む（再登録の場合に設定を引き継ぐため）
  const prevNfcRaw = await env.NFC_URLS.get(body.orderId);
  const prevQrRaw  = await env.NFC_URLS.get('QR:' + body.orderId);
  const prevNfc    = prevNfcRaw ? JSON.parse(prevNfcRaw) : null;
  const prevQr     = prevQrRaw  ? JSON.parse(prevQrRaw)  : null;

  // NFC レコードを登録（既存があればURL・履歴・アクセス数などは保持）
  // ※ options と addonCount は「メールから読み取った最新の事実」なので、
  //   再登録のたびに毎回 body の値で上書きする（オプション後付け購入にも対応）。
  await env.NFC_URLS.put(body.orderId, JSON.stringify({
    orderId:      body.orderId,
    // URL・ラベルは、今回 body で渡されたものがあればそれを、無ければ既存値を保持。
    // （Code.gs からの自動登録では空で来るので、お客さんが設定済みのURLを消さない）
    url:          body.nfcUrl || (prevNfc ? prevNfc.url   : '') || '',
    label:        body.label  || (prevNfc ? prevNfc.label : '') || '',
    history:      prevNfc ? (prevNfc.history     || []) : [],
    registeredAt: prevNfc ? (prevNfc.registeredAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    accessCount:  prevNfc ? (prevNfc.accessCount || 0) : 0,
    lastAccess:   prevNfc ? (prevNfc.lastAccess  || null) : null,
    // ── 購入時に確定する情報（Code.gs がメールから読み取って送ってくる）──
    // options    … 購入済みオプション { nfc:true/false, double:..., diecut:... }
    // addonCount … 2枚目以降の追加枚数（管理画面の注文詳細に表示）
    // 再登録時は毎回上書き。ただし body に無い場合は既存値を保持（手動登録などで消えないように）。
    options:      body.options    || (prevNfc ? prevNfc.options    : {}) || {},
    addonCount:   (body.addonCount != null) ? body.addonCount : (prevNfc ? (prevNfc.addonCount || 0) : 0),
  }));

  // QR レコードを登録（既存があればURL・履歴・アクセス数を保持）
  await env.NFC_URLS.put('QR:' + body.orderId, JSON.stringify({
    orderId:      body.orderId,
    url:          body.qrUrl || (prevQr ? prevQr.url : '') || '',
    history:      prevQr ? (prevQr.history      || []) : [],
    registeredAt: prevQr ? (prevQr.registeredAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    accessCount:  prevQr ? (prevQr.accessCount || 0) : 0,
    lastAccess:   prevQr ? (prevQr.lastAccess  || null) : null,
  }));

  return json({ ok: true }, 200, cors);
}

// 注文データを保存（page2 から直接送信）
async function handleSaveOrder(request, env, cors) {
  try {
    const body = await request.json();
    if (!body.orderId) return json({ error: 'orderId が必要です' }, 400, cors);

    // 管理者（パスワード認証あり）かどうかを判定
    const auth    = request.headers.get('Authorization');
    const isAdmin = auth === adminBearer(env);

    // お客さん（認証なし）の場合は、すでに KV に登録済みの注文番号だけを許可する。
    // 登録済みの番号（管理者登録や自動登録で作られたもの）なら桁数は問わない。
    // 未登録の番号は拒否（未購入・打ち間違い対策）。
    // 管理者の場合はこのチェックを通さず、好きな番号で保存できる。
    if (!isAdmin) {
      const isRegistered = !!(await env.NFC_URLS.get(body.orderId));
      if (!isRegistered) {
        return json({
          error: 'この注文番号は登録されていません。番号をご確認ください。'
        }, 400, cors);
      }
    }

    await env.NFC_URLS.put('ORDER:' + body.orderId, JSON.stringify({
      ...body,
      savedAt: new Date().toISOString(),
    }));
    return json({ ok: true }, 200, cors);
  } catch(e) {
    return json({ error: e.toString() }, 500, cors);
  }
}

// ═══════════════════════════════════════════════
// オプション在庫（オプション単体注文の管理）
// ═══════════════════════════════════════════════
// オプション単体注文を「OPT:注文番号」キーで保存する。本体キーホルダー注文とは別枠。
// レコード構造：
//   {
//     orderId, options:{nfc,double,diecut}, addonCount,
//     used:false,        // 使用済みか（他の本体に適用済みか）
//     usedFor:null,      // 適用先の本体注文番号
//     registeredAt, usedAt
//   }

// オプション在庫を登録（管理者：Code.gs から呼ばれる）
async function handleOptRegister(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const body = await request.json();
  if (!body.orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  // 既存レコードがあれば used / usedFor は保持（再登録で使用済み状態を消さない）
  const prevRaw = await env.NFC_URLS.get('OPT:' + body.orderId);
  const prev    = prevRaw ? JSON.parse(prevRaw) : null;

  await env.NFC_URLS.put('OPT:' + body.orderId, JSON.stringify({
    orderId:      body.orderId,
    options:      body.options    || {},
    addonCount:   body.addonCount || 0,
    used:         prev ? !!prev.used    : false,
    usedFor:      prev ? (prev.usedFor || null) : null,
    registeredAt: prev ? (prev.registeredAt || new Date().toISOString()) : new Date().toISOString(),
    usedAt:       prev ? (prev.usedAt || null) : null,
  }));
  return json({ ok: true }, 200, cors);
}

// オプション在庫の状態を取得（公開：page4 と Code.gs が利用）
async function handleOptGet(request, env, cors) {
  const url     = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  const raw = await env.NFC_URLS.get('OPT:' + orderId);
  if (!raw) return json({ exists: false }, 200, cors);

  const rec = JSON.parse(raw);
  return json({
    exists:     true,
    orderId:    rec.orderId,
    options:    rec.options    || {},
    addonCount: rec.addonCount || 0,
    used:       !!rec.used,
    usedFor:    rec.usedFor || null,
  }, 200, cors);
}

// オプション在庫を本体注文に適用（公開：page4 から呼ばれる）
// お客さんが「本体注文番号」と「オプション注文番号」を入力 → 紐付け実行。
async function handleOptApply(request, env, cors) {
  try {
    const body        = await request.json();
    const bodyOrderId = (body.bodyOrderId || '').trim();   // 本体キーホルダーの注文番号
    const optOrderId  = (body.optOrderId  || '').trim();   // オプション単体の注文番号

    if (!bodyOrderId || !optOrderId) {
      return json({ error: '本体の注文番号とオプションの注文番号の両方を入力してください。' }, 400, cors);
    }
    if (bodyOrderId === optOrderId) {
      return json({ error: '本体とオプションに同じ注文番号は使えません。' }, 400, cors);
    }

    // ① 本体注文が存在するか
    const bodyRaw = await env.NFC_URLS.get(bodyOrderId);
    if (!bodyRaw) {
      return json({ error: '本体の注文番号が見つかりません。番号をご確認ください。' }, 404, cors);
    }

    // ② オプション在庫が存在するか
    const optRaw = await env.NFC_URLS.get('OPT:' + optOrderId);
    if (!optRaw) {
      return json({ error: 'オプションの注文番号が見つかりません。番号をご確認ください。' }, 404, cors);
    }
    const optRec = JSON.parse(optRaw);

    // ③ すでに使用済みなら拒否
    if (optRec.used) {
      return json({
        error: 'このオプション注文番号はすでに使用済みです。別のキーホルダーに適用されています。'
      }, 409, cors);
    }

    // ④ 本体注文に、オプション在庫の内容をマージ（OR 結合）して反映
    const bodyRec = JSON.parse(bodyRaw);
    const curOpt  = bodyRec.options || {};
    const addOpt  = optRec.options  || {};
    const merged  = {
      nfc:    !!(curOpt.nfc    || addOpt.nfc),
      double: !!(curOpt.double || addOpt.double),
      diecut: !!(curOpt.diecut || addOpt.diecut),
    };
    bodyRec.options    = merged;
    // 追加枚数は加算する（既存 + 今回のオプション注文分）
    bodyRec.addonCount = (bodyRec.addonCount || 0) + (optRec.addonCount || 0);
    bodyRec.updatedAt  = new Date().toISOString();

    // ⑤ オプション在庫を使用済みにする
    optRec.used    = true;
    optRec.usedFor = bodyOrderId;
    optRec.usedAt  = new Date().toISOString();

    // ⑥ 両方を保存（本体 → オプションの順。本体保存後にオプションを使用済みに）
    await env.NFC_URLS.put(bodyOrderId, JSON.stringify(bodyRec));
    await env.NFC_URLS.put('OPT:' + optOrderId, JSON.stringify(optRec));

    return json({
      ok: true,
      applied: addOpt,
      addonAdded: optRec.addonCount || 0,
      bodyOptions: merged,
    }, 200, cors);
  } catch (e) {
    return json({ error: e.toString() }, 500, cors);
  }
}

// オプション在庫の一覧を取得（管理者）
async function handleOptList(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const list = await env.NFC_URLS.list({ prefix: 'OPT:' });
  const items = [];
  for (const key of list.keys) {
    const raw = await env.NFC_URLS.get(key.name);
    if (!raw) continue;
    const rec = JSON.parse(raw);
    items.push({
      orderId:    rec.orderId,
      options:    rec.options    || {},
      addonCount: rec.addonCount || 0,
      used:       !!rec.used,
      usedFor:    rec.usedFor || null,
      registeredAt: rec.registeredAt || null,
      usedAt:     rec.usedAt || null,
    });
  }
  // 新しい登録順に並べる
  items.sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0));
  return json({ ok: true, items }, 200, cors);
}

// オプション在庫の使用済み/未使用を手動で切り替え（管理者）
async function handleOptSetUsed(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const body    = await request.json();
  const orderId = (body.orderId || '').trim();
  if (!orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  const raw = await env.NFC_URLS.get('OPT:' + orderId);
  if (!raw) return json({ error: 'オプション在庫が見つかりません' }, 404, cors);

  const rec = JSON.parse(raw);
  rec.used = !!body.used;
  if (rec.used) {
    rec.usedAt = rec.usedAt || new Date().toISOString();
  } else {
    // 未使用に戻す場合は適用先・使用日時もクリア（トラブル対応用）
    rec.usedFor = null;
    rec.usedAt  = null;
  }
  await env.NFC_URLS.put('OPT:' + orderId, JSON.stringify(rec));
  return json({ ok: true, used: rec.used }, 200, cors);
}

// 注文データを取得（管理画面・注文詳細ページ用）
async function handleGetOrder(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const url     = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  if (!orderId) return json({ error: 'orderId が必要です' }, 400, cors);

  const stored = await env.NFC_URLS.get('ORDER:' + orderId);
  if (!stored)  return json({ error: '注文データが見つかりません' }, 404, cors);
  return json({ ok: true, order: JSON.parse(stored) }, 200, cors);
}

// 在庫・メンテナンス設定を保存（管理者専用）
// KV に INVENTORY キーで以下の構造を保存：
//   { maintenance: bool, maintenanceMsg: string, colors: { "カラー名": { soldOut: bool, hidden: bool } } }
async function handleInventory(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const body    = await request.json();
  const stored  = await env.NFC_URLS.get('INVENTORY');
  const current = stored ? JSON.parse(stored) : {};
  const updated = { ...current, ...body, updatedAt: new Date().toISOString() };

  await env.NFC_URLS.put('INVENTORY', JSON.stringify(updated));
  return json({ ok: true, inventory: updated }, 200, cors);
}

// 在庫・メンテナンス設定を取得（公開・認証不要 → page2 から参照）
async function handleGetInventory(request, env, cors) {
  const stored = await env.NFC_URLS.get('INVENTORY');
  if (!stored) return json({ ok: true, inventory: { maintenance: false, maintenanceMsg: '', colors: {} } }, 200, cors);
  return json({ ok: true, inventory: JSON.parse(stored) }, 200, cors);
}

// 全データをエクスポート（バックアップ書き出し）
async function handleExport(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  const allKeys = await listAllKeys(env);
  const data    = {};
  for (const k of allKeys) {
    const v = await env.NFC_URLS.get(k.name);
    if (v !== null) data[k.name] = v; // JSON文字列のまま保持
  }

  return json({
    type:       'buki-booth-backup',
    version:    1,
    exportedAt: new Date().toISOString(),
    count:      Object.keys(data).length,
    data,
  }, 200, cors);
}

// バックアップをインポートして KV へ書き戻す
async function handleImport(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);

  let body;
  try { body = await request.json(); }
  catch(e) { return json({ error: 'JSONの読み込みに失敗しました' }, 400, cors); }

  if (!body || body.type !== 'buki-booth-backup' || !body.data || typeof body.data !== 'object') {
    return json({ error: 'バックアップファイルの形式が正しくありません' }, 400, cors);
  }

  let imported = 0;
  for (const [key, val] of Object.entries(body.data)) {
    await env.NFC_URLS.put(key, typeof val === 'string' ? val : JSON.stringify(val));
    imported++;
  }

  return json({ ok: true, imported }, 200, cors);
}


// ═══════════════════════════════════════════════
// 注文詳細ページ（管理者・パスワード認証）
// ═══════════════════════════════════════════════

async function handleOrderDetail(path, request, env, origin) {
  const url = new URL(request.url);
  const pw  = url.searchParams.get('pw');
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
    return new Response(orderAuthHTML(path), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  const orderId = path.replace('/order/', '').trim();
  const stored  = await env.NFC_URLS.get('ORDER:' + orderId);
  if (!stored) {
    return new Response('<h2 style="font-family:sans-serif;padding:40px;">注文データが見つかりません: ' + orderId + '</h2>', {
      status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
  const order  = JSON.parse(stored);

  // NFC・QR レコード（URL履歴を含む）も取得して詳細ページへ渡す
  const nfcRaw = await env.NFC_URLS.get(orderId);
  const qrRaw  = await env.NFC_URLS.get('QR:' + orderId);
  const nfcRec = nfcRaw ? JSON.parse(nfcRaw) : {};
  const qrRec  = qrRaw  ? JSON.parse(qrRaw)  : {};

  return new Response(orderDetailHTML(order, origin, pw, nfcRec, qrRec), {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// 注文詳細認証ページ
function orderAuthHTML(path) {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>注文詳細 — 認証</title>
<style>body{font-family:'Noto Sans JP',sans-serif;background:#f6f7f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.box{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:32px 24px;width:320px;box-shadow:0 8px 24px -12px rgba(0,0,0,.12);}
h2{font-size:16px;margin-bottom:16px;}
input{width:100%;padding:11px 13px;border:1.5px solid #e4e7ec;border-radius:9px;font-size:14px;margin-bottom:10px;box-sizing:border-box;}
button{width:100%;padding:12px;background:#3257d6;border:none;border-radius:9px;color:#fff;font-size:14px;cursor:pointer;}
</style></head><body><div class="box">
<h2>🔐 管理者パスワードを入力</h2>
<input type="password" id="pw" placeholder="パスワード">
<button onclick="location.href='${path}?pw='+document.getElementById('pw').value">ログイン</button>
</div></body></html>`;
}

// 注文詳細ページ本体（URL履歴表示 + 最新の穴レンダラー対応）
function orderDetailHTML(order, origin, pw, nfcRec = {}, qrRec = {}) {
  const shapeNames = { circle:'丸型', square:'四角形', rect:'自由四角', diecut:'ダイカット' };
  const shape = shapeNames[order.shape] || order.shape || '—';

  // サイズ表示：自由四角は横×縦、ダイアは長辺×短辺、その他は長辺
  let sizeText;
  if (order.shape === 'rect' && order.widthCm && order.heightCm) {
    sizeText = order.widthCm + ' × ' + order.heightCm + ' cm';
  } else if (order.shape === 'diecut' && order.sizeCm) {
    const p = order.dieFront || order.dieBack; let asp = 1;
    if (p && p.length >= 3) {
      let x0=1,y0=1,x1=0,y1=0;
      for (let i=0;i<p.length;i++){ if(p[i].x<x0)x0=p[i].x; if(p[i].x>x1)x1=p[i].x; if(p[i].y<y0)y0=p[i].y; if(p[i].y>y1)y1=p[i].y; }
      const lng=Math.max(x1-x0,y1-y0), sht=Math.min(x1-x0,y1-y0); asp = lng>0?sht/lng:1;
    }
    sizeText = order.sizeCm + ' × ' + (order.sizeCm*asp).toFixed(1) + ' cm';
  } else {
    sizeText = (order.sizeCm || '—') + ' cm';
  }

  // 日時を見やすく整形
  const fmtDate = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.getFullYear() + '/' + ('0'+(d.getMonth()+1)).slice(-2) + '/' + ('0'+d.getDate()).slice(-2)
        + ' ' + ('0'+d.getHours()).slice(-2) + ':' + ('0'+d.getMinutes()).slice(-2);
    } catch(e) { return iso; }
  };

  // URL履歴を HTML に変換（最大3件）
  const histRows = (hist) => {
    if (!hist || !hist.length) return '<div style="font-size:12px;color:#6b6860;padding:4px 0;">変更履歴はまだありません</div>';
    return hist.map((h, i) =>
      '<div style="padding:8px 0;border-bottom:1px solid #ece8df;">' +
        '<div style="font-size:11px;color:#6b6860;margin-bottom:2px;">' + (i+1) + 'つ前（' + fmtDate(h.at) + ' まで使用）</div>' +
        '<div style="font-size:12px;word-break:break-all;"><a href="' + (h.url||'') + '" target="_blank" style="color:#1a6fa8;">' + (h.url||'（空）') + '</a></div>' +
      '</div>'
    ).join('');
  };

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>注文詳細 — ${order.orderId}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans JP',sans-serif;background:#f6f7f9;color:#1a1d23;padding-bottom:60px;}
.topbar{background:#1a1d23;padding:13px 20px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-family:'Inter',sans-serif;font-weight:700;font-size:16px;color:#fff;}
.back-btn{font-size:12px;color:rgba(255,255,255,.5);text-decoration:none;border:1px solid rgba(255,255,255,.2);padding:5px 12px;border-radius:20px;}
.wrap{max-width:700px;margin:0 auto;padding:24px 16px;}
.order-header{background:#fff;border-radius:14px;border:1px solid #e4e7ec;padding:20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;}
.order-id{font-family:monospace;font-size:18px;font-weight:700;}
.order-date{font-size:12px;color:#6b7280;}
.card{background:#fff;border-radius:14px;border:1px solid #e4e7ec;margin-bottom:14px;overflow:hidden;}
.card-head{padding:11px 16px;background:#f3f4f6;border-bottom:1px solid #e4e7ec;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;}
.card-body{padding:16px;}
.row{display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid #eef1f4;gap:16px;}
.row:last-child{border-bottom:none;padding-bottom:0;}
.row-label{font-size:12px;color:#6b7280;flex-shrink:0;}
.row-val{font-size:13px;font-weight:500;text-align:right;word-break:break-all;}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500;}
.badge-yes{background:#eef2fe;color:#3257d6;}
.badge-no{background:#eef1f4;color:#6b7280;}
.color-dot{display:inline-block;width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(0,0,0,.12);vertical-align:middle;margin-right:5px;}
.img-grid{display:flex;gap:16px;flex-wrap:wrap;}
.img-block{flex:1;min-width:140px;text-align:center;}
.img-block label{font-size:11px;color:#6b7280;display:block;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;}
.img-block img{width:100%;max-width:200px;border-radius:10px;border:1px solid #e4e7ec;display:block;margin:0 auto 8px;}
.dl-btn{display:inline-block;padding:8px 16px;background:#1a1d23;color:#fff;border-radius:8px;font-size:12px;text-decoration:none;}
.minimap-row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;}
.minimap-block{flex:1;min-width:120px;}
.minimap-block label{font-size:11px;color:#6b7280;display:block;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;}
.minimap-info{font-size:12px;color:#6b7280;margin-top:6px;line-height:1.7;}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head>
<body>
<div class="topbar">
  <div class="logo">NFC ADMIN</div>
  <a href="/admin" class="back-btn">← 一覧に戻る</a>
</div>
<div class="wrap">

  <div class="order-header">
    <div>
      <div style="font-size:11px;color:#6b6860;margin-bottom:4px;">注文番号</div>
      <div class="order-id">${order.orderId}</div>
    </div>
    <div class="order-date">送信日時: ${fmtDate(order.submittedAt || order.savedAt)}</div>
  </div>

  <!-- 基本情報 -->
  <div class="card">
    <div class="card-head">📋 基本情報</div>
    <div class="card-body">
      <div class="row"><span class="row-label">土台カラー</span>
        <span class="row-val"><span class="color-dot" style="background:${order.colorHex||'#ddd'};${order.colorHex==='#FFFFFF'?'border-color:#ccc':''}"></span>${order.color||'—'}</span></div>
      <div class="row"><span class="row-label">形状</span><span class="row-val">${shape}</span></div>
      <div class="row"><span class="row-label">サイズ</span><span class="row-val">${sizeText}</span></div>
      <div class="row"><span class="row-label">厚さ</span><span class="row-val">${order.thickCm||'—'} mm</span></div>
    </div>
  </div>

  <!-- 購入されたオプション（BOOTHの注文メールから自動取得） -->
  <div class="card">
    <div class="card-head">🛒 購入されたオプション（BOOTH）</div>
    <div class="card-body">
      <div class="row"><span class="row-label">NFCタグ</span>
        <span class="row-val">${(nfcRec.options&&nfcRec.options.nfc) ? '<span class="badge badge-yes">購入あり</span>' : '<span class="badge badge-no">なし</span>'}</span></div>
      <div class="row"><span class="row-label">両面印刷</span>
        <span class="row-val">${(nfcRec.options&&nfcRec.options.double) ? '<span class="badge badge-yes">購入あり</span>' : '<span class="badge badge-no">なし</span>'}</span></div>
      <div class="row"><span class="row-label">2枚目以降（追加）</span>
        <span class="row-val">${(nfcRec.addonCount||0) > 0 ? `<strong style="color:#3257d6;">${nfcRec.addonCount} 枚追加</strong>` : '0 枚'}</span></div>
    </div>
  </div>

  <!-- オプション -->
  <div class="card">
    <div class="card-head">⚙️ オプション</div>
    <div class="card-body">
      <div class="row"><span class="row-label">NFCタグ</span>
        <span class="row-val">${order.nfc ? '<span class="badge badge-yes">あり +¥200</span>' : '<span class="badge badge-no">なし</span>'}</span></div>
      ${order.nfc ? `<div class="row"><span class="row-label">NFC URL</span><span class="row-val" style="font-size:12px;">${order.nfcUrl||'（未入力）'}</span></div>` : ''}
      <div class="row"><span class="row-label">裏面印刷</span>
        <span class="row-val">${order.backPrint ? '<span class="badge badge-yes">あり +¥100</span>' : '<span class="badge badge-no">なし</span>'}</span></div>
      <div class="row"><span class="row-label">QRコード</span>
        <span class="row-val">${order.qr ? `<span class="badge badge-yes">あり</span> <span style="font-size:12px;color:#6b6860;">${{front:'おもて面',back:'うら面',both:'両面'}[order.qrSide]||''}</span>` : '<span class="badge badge-no">なし</span>'}</span></div>
      ${order.qr && order.qrUrl ? `<div class="row"><span class="row-label">QR URL</span><span class="row-val" style="font-size:12px;">${order.qrUrl}</span></div>` : ''}
    </div>
  </div>

  <!-- NFC URL 変更履歴 -->
  <div class="card">
    <div class="card-head">📜 NFC URL の変更履歴（バックアップ）</div>
    <div class="card-body">
      <div class="row" style="border-bottom:1px solid #ece8df;">
        <span class="row-label">現在のURL</span>
        <span class="row-val" style="font-size:12px;">${nfcRec.url ? `<a href="${nfcRec.url}" target="_blank" style="color:#1a6fa8;">${nfcRec.url}</a>` : '未設定'}</span>
      </div>
      <div style="margin-top:10px;">${histRows(nfcRec.history)}</div>
    </div>
  </div>

  <!-- QR URL 変更履歴 -->
  <div class="card">
    <div class="card-head">📜 QR URL の変更履歴（バックアップ）</div>
    <div class="card-body">
      <div class="row" style="border-bottom:1px solid #ece8df;">
        <span class="row-label">現在のURL</span>
        <span class="row-val" style="font-size:12px;">${qrRec.url ? `<a href="${qrRec.url}" target="_blank" style="color:#1a6fa8;">${qrRec.url}</a>` : '未設定'}</span>
      </div>
      <div style="margin-top:10px;">${histRows(qrRec.history)}</div>
    </div>
  </div>

  <!-- 画像 -->
  <div class="card">
    <div class="card-head">🖼️ キーホルダー画像</div>
    <div class="card-body">
      <div class="img-grid">
        ${order.imgFront ? `
        <div class="img-block">
          ${order.backPrint ? '<label>おもて面</label>' : ''}
          <img src="${order.imgFront}" alt="おもて面">
          <a class="dl-btn" id="dlFront" download="front_${order.orderId}.png">⬇ ダウンロード</a>
        </div>` : '<p style="color:#6b6860;font-size:13px;">画像なし</p>'}
        ${order.backPrint && order.imgBack ? `
        <div class="img-block">
          <label>うら面</label>
          <img src="${order.imgBack}" alt="うら面">
          <a class="dl-btn" id="dlBack" download="back_${order.orderId}.png">⬇ ダウンロード</a>
        </div>` : ''}
      </div>
    </div>
  </div>

  <!-- NFC位置 -->
  ${order.nfc && order.nfcPos ? `
  <div class="card">
    <div class="card-head">📍 NFCタグの位置</div>
    <div class="card-body">
      <div class="minimap-row" id="nfcMiniRow"></div>
    </div>
  </div>` : ''}

  <!-- QR位置 -->
  ${order.qr && order.qrSide ? `
  <div class="card">
    <div class="card-head">📍 QRコードの位置</div>
    <div class="card-body">
      <div class="minimap-row" id="qrMiniRow"></div>
    </div>
  </div>` : ''}

  <!-- 穴の位置 -->
  <div class="card">
    <div class="card-head">🔩 穴の位置</div>
    <div class="card-body">
      <div class="minimap-row" style="align-items:flex-start;gap:20px;">
        <canvas id="attachCv" width="200" height="200" style="border-radius:10px;border:1.5px solid #ccc8be;flex-shrink:0;"></canvas>
        <div class="minimap-info" style="padding-top:8px;font-size:13px;line-height:2;">
          X: <strong>${Math.round(order.attX||50)}%</strong><br>
          Y: <strong>${Math.round(order.attY||10)}%</strong><br>
          状態: <strong>${order.attMode==='outside'?'外付けツメ':'本体内'}</strong><br>
          穴径: <strong>5mm</strong>
          <div style="margin-top:12px;"><button onclick="openZoom(ZOOM_HOLE)" style="padding:6px 14px;border:1.5px solid #ccc8be;border-radius:8px;background:#fff;cursor:pointer;font-family:'Noto Sans JP',sans-serif;font-size:12px;color:#0f0f0d;">🔍 拡大</button></div>
        </div>
      </div>
    </div>
  </div>

</div>

<!-- 拡大表示モーダル -->
<div id="zoomModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:300;align-items:center;justify-content:center;padding:18px;" onclick="closeZoom(event)">
  <div style="background:#fff;border-radius:14px;padding:18px 18px 16px;max-width:94vw;max-height:92vh;overflow:auto;text-align:center;">
    <div id="zoomTitle" style="font-size:14px;font-weight:700;color:#0f0f0d;margin-bottom:12px;"></div>
    <canvas id="zoomCv" style="border-radius:10px;border:1.5px solid #ccc8be;display:block;margin:0 auto;max-width:86vw;height:auto;"></canvas>
    <div id="zoomInfo" style="font-size:13px;color:#6b6860;margin-top:12px;line-height:1.9;"></div>
    <button onclick="closeZoom()" style="margin-top:14px;padding:9px 24px;border:none;border-radius:9px;background:#0f0f0d;color:#fff;font-family:'Noto Sans JP',sans-serif;font-size:13px;cursor:pointer;">閉じる</button>
  </div>
</div>

<script>
const ORDER = ${JSON.stringify(order)};

// （QRコードの生成・ダウンロードは管理一覧の「URL一覧」ボタンに集約したため、ここでは行わない）

// ダウンロードリンクにhrefをセット
const dlF = document.getElementById('dlFront');
if (dlF && ORDER.imgFront) dlF.href = ORDER.imgFront;
const dlB = document.getElementById('dlBack');
if (dlB && ORDER.imgBack) dlB.href = ORDER.imgBack;

// ── QR ミニマップ描画 ──
function rrect(ctx,x,y,w,h,r){ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();}

// ダイカットの中抜き穴を描画。mode='cut'=透明にくり抜き / 'fill'=指定色で塗り
function diePunchHoles(ctx, holes, ox, oy, w, h, mode, bg) {
  if (!holes || !holes.length) return;
  function path(hl){ ctx.beginPath(); ctx.moveTo(ox+hl[0].x*w, oy+hl[0].y*h); for(var i=1;i<hl.length;i++) ctx.lineTo(ox+hl[i].x*w, oy+hl[i].y*h); ctx.closePath(); }
  ctx.save(); if(mode==='cut') ctx.globalCompositeOperation='destination-out';
  for(var k=0;k<holes.length;k++){ var hl=holes[k]; if(!hl||hl.length<3) continue; path(hl); ctx.fillStyle=(mode==='cut')?'#000':(bg||'#16161a'); ctx.fill(); }
  ctx.restore();
  ctx.save(); ctx.lineWidth=1; ctx.strokeStyle=(mode==='cut')?'rgba(0,0,0,.2)':'rgba(255,255,255,.22)';
  for(var k2=0;k2<holes.length;k2++){ var hl2=holes[k2]; if(!hl2||hl2.length<3) continue; path(hl2); ctx.stroke(); }
  ctx.restore();
}

// ダイカット：シルエットがフレームの何割を占めるか（page2のフィットと一致）
var DIE_FIT = 0.82;
// 折れ防止OFF用：画像のアルファに沿って本体を描く（穴・すき間はそのまま透過）。withImage=false で無地アクリル
var _dieSilCv = null;
function drawDieBodyAlpha(ctx, img, x, y, s, acryl, borderPx, withImage) {
  s = Math.round(s);
  var blank = (withImage === false);
  var needSil = (borderPx >= 0.5) || blank;
  if (needSil) {
    var pad = Math.ceil(Math.max(0, borderPx)) + 1, tw = s + pad * 2;
    if (!_dieSilCv) _dieSilCv = document.createElement('canvas');
    if (_dieSilCv.width !== tw || _dieSilCv.height !== tw) { _dieSilCv.width = tw; _dieSilCv.height = tw; }
    var sc = _dieSilCv.getContext('2d');
    sc.setTransform(1,0,0,1,0,0); sc.clearRect(0,0,tw,tw);
    sc.drawImage(img, pad, pad, s, s);
    sc.globalCompositeOperation = 'source-in'; sc.fillStyle = acryl; sc.fillRect(0,0,tw,tw);
    sc.globalCompositeOperation = 'source-over';
    if (borderPx >= 0.5) { var steps = 20; for (var i = 0; i < steps; i++) { var a = i*2*Math.PI/steps; ctx.drawImage(_dieSilCv, x-pad+Math.cos(a)*borderPx, y-pad+Math.sin(a)*borderPx); } }
    if (blank) ctx.drawImage(_dieSilCv, x-pad, y-pad);
  }
  if (!blank) ctx.drawImage(img, x, y, s, s);
}
function dieBorderPx(s) { return (ORDER.sizeCm ? (ORDER.borderCm || 0) / ORDER.sizeCm : 0) * s * DIE_FIT; }

// ── 拡大表示（QR位置・穴位置 共通モーダル）──
var ZOOM_SCALE = 3, ZOOM_QR = {}, ZOOM_HOLE = null, ZOOM_NFC = null;
function openZoom(rec){
  if(!rec) return;
  var cv = document.getElementById('zoomCv');
  document.getElementById('zoomTitle').textContent = rec.label || '拡大表示';
  document.getElementById('zoomInfo').innerHTML = rec.info || '';
  rec.paint(cv, ZOOM_SCALE);                 // 同じ絵を高解像度で再描画（ぼやけない）
  document.getElementById('zoomModal').style.display = 'flex';
}
function closeZoom(e){ if(e && e.target !== e.currentTarget) return; var m=document.getElementById('zoomModal'); if(m) m.style.display='none'; }
window.addEventListener('keydown', function(e){ if(e.key==='Escape') closeZoom(); });

// ── QR ミニマップ描画（等倍=1 / 拡大=ZOOM_SCALE、論理サイズ160のまま transform で拡大）──
// 土台色に応じてQRの視認色（黒/白）を返す
function qrInk(hex){
  var h=(hex||'#d9d4c7').replace('#','');
  if(h.length===3) h=h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
  var r=parseInt(h.substr(0,2),16),g=parseInt(h.substr(2,2),16),b=parseInt(h.substr(4,2),16);
  return (0.299*r+0.587*g+0.114*b)>150 ? '#111111' : '#ffffff';
}
function drawQRMini(containerId, qrData, imgSrc) {
  var row = document.getElementById(containerId);
  if (!row) return;
  var block = document.createElement('div'); block.className='minimap-block';
  var lbl = document.createElement('label'); lbl.textContent = {front:'おもて面',back:'うら面'}[qrData.side]||qrData.side; block.appendChild(lbl);
  var cv = document.createElement('canvas'); cv.width=160; cv.height=160; cv.style.cssText='border-radius:8px;border:1.5px solid #ccc8be;'; block.appendChild(cv);
  row.appendChild(block);
  var info = document.createElement('div'); info.className='minimap-info'; info.style.paddingTop='8px';
  var infoHTML = 'サイズ: <strong>'+qrData.cm.toFixed(1)+'cm</strong><br>X: <strong>'+Math.round(qrData.x)+'%</strong><br>Y: <strong>'+Math.round(qrData.y)+'%</strong>';
  info.innerHTML = infoHTML; block.appendChild(info);

  // 拡大ボタン
  var zb = document.createElement('button');
  zb.textContent = '🔍 拡大';
  zb.style.cssText = 'margin-top:10px;padding:6px 14px;border:1.5px solid #ccc8be;border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;font-size:12px;color:#0f0f0d;';
  block.appendChild(zb);

  // 形状データ（サイズ非依存）
  var poly  = (ORDER.shape==='diecut') ? ((qrData.side==='back' ? ORDER.dieBack : ORDER.dieFront) || ORDER.dieFront || ORDER.dieBack || null) : null;
  var holes = (ORDER.shape==='diecut') ? ((qrData.side==='back' ? ORDER.dieHolesBack : ORDER.dieHolesFront) || ORDER.dieHolesFront || ORDER.dieHolesBack || []) : [];
  var isDie = (ORDER.shape==='diecut' && poly && poly.length>=3);
  var cachedImg = null;

  // 任意キャンバスへ scale 倍率で描画
  function paint(tcv, scale, img) {
    var L=160; tcv.width=Math.round(L*scale); tcv.height=Math.round(L*scale);
    var ctx=tcv.getContext('2d'); ctx.setTransform(scale,0,0,scale,0,0);
    var aw=L, ah=L, m=12;
    var _box=Math.min(aw,ah)-m*2, kw=_box, kh=_box;
    if (ORDER.shape==='rect' && ORDER.widthCm && ORDER.heightCm) { var _ar=ORDER.widthCm/ORDER.heightCm; if(_ar>=1){kw=_box;kh=_box/_ar;}else{kh=_box;kw=_box*_ar;} }
    var ox=(aw-kw)/2, oy=(ah-kh)/2;
    function khPath(){ ctx.beginPath(); if(isDie){ ctx.moveTo(ox+poly[0].x*kw, oy+poly[0].y*kh); for(var i=1;i<poly.length;i++) ctx.lineTo(ox+poly[i].x*kw, oy+poly[i].y*kh); ctx.closePath(); } else if(ORDER.shape==='circle') ctx.arc(ox+kw/2,oy+kh/2,kw/2,0,Math.PI*2); else rrect(ctx,ox,oy,kw,kh,8); }
    ctx.clearRect(0,0,aw,ah);
    ctx.fillStyle='#16161a'; ctx.fillRect(0,0,aw,ah);                              // 暗背景で視認性確保
    var dieOff = (ORDER.shape==='diecut' && ORDER.dieReinforce===false && img);
    if(dieOff){
      drawDieBodyAlpha(ctx, img, ox, oy, kw, ORDER.colorHex||'#d9d4c7', (ORDER.sizeCm ? (ORDER.borderCm||0)/ORDER.sizeCm : 0) * kw * DIE_FIT, true);
    } else {
      ctx.save(); khPath();
      if(img){ ctx.clip(); if(isDie){ctx.fillStyle=ORDER.colorHex||'#d9d4c7';ctx.fillRect(ox,oy,kw,kh);} var ir=img.naturalWidth/img.naturalHeight,kr=kw/kh,dw,dh,dx,dy; if(ir>kr){dh=kh;dw=dh*ir;dx=ox-(dw-kw)/2;dy=oy;}else{dw=kw;dh=dw/ir;dy=oy-(dh-kh)/2;dx=ox;} ctx.drawImage(img,dx,dy,dw,dh); }
      else{ ctx.fillStyle=ORDER.colorHex||'#d9d4c7'; ctx.fill(); }                  // 画像が無い面は土台色で塗る
      ctx.restore();
      ctx.strokeStyle='rgba(255,255,255,.30)';ctx.lineWidth=1;khPath();ctx.stroke();  // 暗背景に合わせ白枠
    }
    var ppCm=(ORDER.shape==='diecut'?DIE_FIT*kw:(ORDER.shape==='rect'&&ORDER.widthCm?kw/ORDER.widthCm:kw/(ORDER.sizeCm||7))), qpx=Math.max(10,qrData.cm*ppCm);
    var qx=ox+kw*qrData.x/100-qpx/2, qy=oy+kh*qrData.y/100-qpx/2;
    var ink=qrInk(ORDER.colorHex), halo=(ink==='#ffffff')?'rgba(0,0,0,.5)':'rgba(255,255,255,.8)';
    ctx.setLineDash([]);ctx.lineWidth=2.4;ctx.strokeStyle=halo;ctx.strokeRect(qx,qy,qpx,qpx);                 // ハロー（反対色・実線）
    ctx.lineWidth=1.2;ctx.strokeStyle=ink;ctx.setLineDash([4,3]);ctx.strokeRect(qx,qy,qpx,qpx);ctx.setLineDash([]); // 実寸の点線枠
    ctx.font='bold 8px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    ctx.lineWidth=2.6;ctx.strokeStyle=halo;ctx.strokeText('QR',qx+qpx/2,qy+qpx/2);ctx.fillStyle=ink;ctx.fillText('QR',qx+qpx/2,qy+qpx/2); // QR文字（縁取り＋本体）
  }

  // 拡大登録（クリック時に最新のキャッシュ画像で再描画）
  ZOOM_QR[qrData.side] = { label: lbl.textContent + ' の QRコード位置', info: infoHTML, paint: function(tcv,scale){ paint(tcv,scale,cachedImg); } };
  zb.onclick = function(){ openZoom(ZOOM_QR[qrData.side]); };

  // 画像読込→等倍描画（拡大用に保持）
  if(imgSrc){ var im=new Image(); im.onload=function(){ cachedImg=im; paint(cv,1,im); }; im.onerror=function(){ cachedImg=null; paint(cv,1,null); }; im.src=imgSrc; }
  else paint(cv,1,null);
}
if(ORDER.qr && ORDER.qrSide) {
  if(ORDER.qrSide==='front'||ORDER.qrSide==='both') drawQRMini('qrMiniRow',{...ORDER.qrFront,side:'front'}, ORDER.imgFront);
  if(ORDER.qrSide==='back' ||ORDER.qrSide==='both') drawQRMini('qrMiniRow',{...ORDER.qrBack, side:'back'},  ORDER.imgBack);
}

// ── NFC位置のミニマップ（2.5x1.8cm固定枠・ダイカットpoly対応／scaleで拡大）──
function drawNFCMini(containerId, np, imgSrc) {
  var row = document.getElementById(containerId); if (!row) return;
  var block = document.createElement('div'); block.className='minimap-block';
  var lbl = document.createElement('label'); lbl.textContent = 'NFCタグ'; block.appendChild(lbl);
  var cv = document.createElement('canvas'); cv.width=160; cv.height=160; cv.style.cssText='border-radius:8px;border:1.5px solid #ccc8be;'; block.appendChild(cv);
  row.appendChild(block);
  var W=(np.w||2.4), H=(np.h||1.4);
  var info = document.createElement('div'); info.className='minimap-info'; info.style.paddingTop='8px';
  var infoHTML = 'サイズ: <strong>'+W+'×'+H+'cm</strong><br>X: <strong>'+Math.round(np.x)+'%</strong><br>Y: <strong>'+Math.round(np.y)+'%</strong>';
  info.innerHTML = infoHTML; block.appendChild(info);
  var zb = document.createElement('button'); zb.textContent='🔍 拡大';
  zb.style.cssText='margin-top:10px;padding:6px 14px;border:1.5px solid #ccc8be;border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;font-size:12px;color:#0f0f0d;';
  block.appendChild(zb);
  var poly = (ORDER.shape==='diecut') ? (ORDER.dieFront || ORDER.dieBack || null) : null;
  var isDie = (ORDER.shape==='diecut' && poly && poly.length>=3);
  var cachedImg = null;
  function paint(tcv, scale, img) {
    var L=160; tcv.width=Math.round(L*scale); tcv.height=Math.round(L*scale);
    var ctx=tcv.getContext('2d'); ctx.setTransform(scale,0,0,scale,0,0);
    var aw=L, ah=L, m=12; var _box=Math.min(aw,ah)-m*2, kw=_box, kh=_box;
    if (ORDER.shape==='rect' && ORDER.widthCm && ORDER.heightCm) { var _ar=ORDER.widthCm/ORDER.heightCm; if(_ar>=1){kw=_box;kh=_box/_ar;}else{kh=_box;kw=_box*_ar;} }
    var ox=(aw-kw)/2, oy=(ah-kh)/2;
    function khPath(){ ctx.beginPath(); if(isDie){ ctx.moveTo(ox+poly[0].x*kw, oy+poly[0].y*kh); for(var i=1;i<poly.length;i++) ctx.lineTo(ox+poly[i].x*kw, oy+poly[i].y*kh); ctx.closePath(); } else if(ORDER.shape==='circle') ctx.arc(ox+kw/2,oy+kh/2,kw/2,0,Math.PI*2); else rrect(ctx,ox,oy,kw,kh,8); }
    ctx.clearRect(0,0,aw,ah); ctx.fillStyle='#16161a'; ctx.fillRect(0,0,aw,ah);
    var dieOff = (ORDER.shape==='diecut' && ORDER.dieReinforce===false && img);
    if(dieOff){ drawDieBodyAlpha(ctx, img, ox, oy, kw, ORDER.colorHex||'#d9d4c7', (ORDER.sizeCm ? (ORDER.borderCm||0)/ORDER.sizeCm : 0) * kw * DIE_FIT, true); }
    else {
      ctx.save(); khPath();
      if(img){ ctx.clip(); if(isDie){ctx.fillStyle=ORDER.colorHex||'#d9d4c7';ctx.fillRect(ox,oy,kw,kh);} var ir=img.naturalWidth/img.naturalHeight,kr=kw/kh,dw,dh,dx,dy; if(ir>kr){dh=kh;dw=dh*ir;dx=ox-(dw-kw)/2;dy=oy;}else{dw=kw;dh=dw/ir;dy=oy-(dh-kh)/2;dx=ox;} ctx.drawImage(img,dx,dy,dw,dh); }
      else{ ctx.fillStyle=ORDER.colorHex||'#d9d4c7'; ctx.fill(); }
      ctx.restore();
      ctx.strokeStyle='rgba(255,255,255,.30)';ctx.lineWidth=1;khPath();ctx.stroke();
    }
    var ppCm=(ORDER.shape==='diecut'?DIE_FIT*kw:(ORDER.shape==='rect'&&ORDER.widthCm?kw/ORDER.widthCm:kw/(ORDER.sizeCm||7)));
    var bw=Math.max(10,W*ppCm), bh=Math.max(8,H*ppCm);
    var nx=ox+kw*np.x/100-bw/2, ny=oy+kh*np.y/100-bh/2;
    ctx.setLineDash([]);ctx.lineWidth=2.4;ctx.strokeStyle='rgba(255,255,255,.85)';ctx.strokeRect(nx,ny,bw,bh);
    ctx.lineWidth=1.3;ctx.strokeStyle='#6b78ff';ctx.setLineDash([4,3]);ctx.strokeRect(nx,ny,bw,bh);ctx.setLineDash([]);
    ctx.font='bold 8px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    ctx.lineWidth=2.6;ctx.strokeStyle='rgba(0,0,0,.55)';ctx.strokeText('NFC',nx+bw/2,ny+bh/2);ctx.fillStyle='#cfd6ff';ctx.fillText('NFC',nx+bw/2,ny+bh/2);
  }
  ZOOM_NFC = { label: 'NFCタグの位置', info: infoHTML, paint: function(tcv,scale){ paint(tcv,scale,cachedImg); } };
  zb.onclick = function(){ openZoom(ZOOM_NFC); };
  if(imgSrc){ var im=new Image(); im.onload=function(){ cachedImg=im; paint(cv,1,im); }; im.onerror=function(){ cachedImg=null; paint(cv,1,null); }; im.src=imgSrc; }
  else paint(cv,1,null);
}
if(ORDER.nfc && ORDER.nfcPos) drawNFCMini('nfcMiniRow', ORDER.nfcPos, ORDER.imgFront);

// ── 穴のミニマップ（5mm固定・補強リング/ツメ対応／scaleで拡大再描画）──
function paintHole(tcv, scale, img, blank){
  var ctx=tcv.getContext('2d');
  var aw=200, ah=200; tcv.width=Math.round(aw*scale); tcv.height=Math.round(ah*scale);
  ctx.setTransform(scale,0,0,scale,0,0);
  var WRAP_BG='#16161a';
  var shape  = ORDER.shape || 'circle';
  var sizeCm = ORDER.sizeCm || 7;
  var holeCm = ORDER.holeCm || 0.5;   // 5mm固定
  var acryl  = ORDER.colorHex || '#d9d4c7';
  var attX   = (ORDER.attX!=null ? ORDER.attX : 50);
  var attY   = (ORDER.attY!=null ? ORDER.attY : 10);
  var margin = 20, maxBody = Math.min(aw-margin*2, ah-margin*2);
  var ppc    = maxBody/15;
  // 丸/四角=正方形、自由四角=横/縦、ダイア=正方形フレーム(シルエットが ppc*sizeCm になるよう拡大)
  var bw, bh;
  if (ORDER.shape==='diecut')    { bw = bh = ppc*sizeCm/DIE_FIT; }
  else if (ORDER.shape==='rect') { bw = ppc*(ORDER.widthCm||sizeCm); bh = ppc*(ORDER.heightCm||sizeCm); }
  else                           { bw = bh = ppc*sizeCm; }
  var g = { cx:aw/2, cy:ah/2, w:bw, h:bh, size:Math.max(bw,bh), r:Math.min(bw,bh)/2, x:aw/2-bw/2, y:ah/2-bh/2, rad:Math.min(bw,bh)*0.06 };
  var pxPerCm = ppc;
  var hx = g.x+g.w*attX/100, hy = g.y+g.h*attY/100;
  var holeR = Math.max(2,(holeCm/2)*pxPerCm);
  var lugR  = (holeR+Math.max(8,holeR*0.9))*2/3;   // ディスク半径＝旧サイズの2/3（首と同じ幅に）

  // ダイカット用ポリゴン
  var diePolyN = (shape==='diecut') ? (ORDER.dieFront || ORDER.dieBack || null) : null;
  var diePts = (diePolyN && diePolyN.length>=3) ? diePolyN.map(function(q){return {x:g.x+q.x*g.size, y:g.y+q.y*g.size};}) : null;
  var dieHoles = (shape==='diecut') ? ((ORDER.dieHolesFront && ORDER.dieHolesFront.length ? ORDER.dieHolesFront : ORDER.dieHolesBack) || []) : [];

  function pointInPoly(x,y,pts){ var c=false; for(var i=0,j=pts.length-1;i<pts.length;j=i++){ var xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) c=!c; } return c; }
  function polyCentroid(pts){ var sx=0,sy=0; for(var i=0;i<pts.length;i++){sx+=pts[i].x;sy+=pts[i].y;} return {x:sx/pts.length,y:sy/pts.length}; }
  function segDist(px,py,ax,ay,bx,by){ var dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy,t=l2?((px-ax)*dx+(py-ay)*dy)/l2:0; t=Math.max(0,Math.min(1,t)); return Math.hypot(px-(ax+t*dx),py-(ay+t*dy)); }
  function nearestOnPoly(px,py,pts){ var best=null,bd=1e18; for(var i=0,j=pts.length-1;i<pts.length;j=i++){ var ax=pts[j].x,ay=pts[j].y,bx=pts[i].x,by=pts[i].y,dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy,t=l2?((px-ax)*dx+(py-ay)*dy)/l2:0; t=Math.max(0,Math.min(1,t)); var qx=ax+t*dx,qy=ay+t*dy,d=(px-qx)*(px-qx)+(py-qy)*(py-qy); if(d<bd){bd=d;best={x:qx,y:qy};} } return best; }
  function minEdgeDist(x,y,pts){ var m=1e9; for(var i=0,j=pts.length-1;i<pts.length;j=i++) m=Math.min(m,segDist(x,y,pts[j].x,pts[j].y,pts[i].x,pts[i].y)); return m; }
  function segSegInt(x1,y1,x2,y2,x3,y3,x4,y4){ var d=(x2-x1)*(y4-y3)-(y2-y1)*(x4-x3); if(Math.abs(d)<1e-9) return null; var t=((x3-x1)*(y4-y3)-(y3-y1)*(x4-x3))/d,u=((x3-x1)*(y2-y1)-(y3-y1)*(x2-x1))/d; if(t>=0&&t<=1&&u>=0&&u<=1) return {x:x1+t*(x2-x1),y:y1+t*(y2-y1),t:t}; return null; }
  function rayPolyHit(cx,cy,px,py,pts){ var dx=px-cx,dy=py-cy,fx=cx+dx*1000,fy=cy+dy*1000,best=null,bt=-1; for(var i=0,j=pts.length-1;i<pts.length;j=i++){ var r=segSegInt(cx,cy,fx,fy,pts[j].x,pts[j].y,pts[i].x,pts[i].y); if(r&&r.t>bt){bt=r.t;best={x:r.x,y:r.y};} } return best; }

  function diePath(c){ c.beginPath(); c.moveTo(diePts[0].x,diePts[0].y); for(var i=1;i<diePts.length;i++) c.lineTo(diePts[i].x,diePts[i].y); c.closePath(); }
  function bodyPath(c){ if(shape==='diecut'&&diePts){ diePath(c); return; } c.beginPath(); if(shape==='circle') c.arc(g.cx,g.cy,g.r,0,Math.PI*2); else rrect(c,g.x,g.y,g.w,g.h,g.rad); }
  function lugFullyInside(px,py,lr){ if(shape==='diecut'&&diePts) return pointInPoly(px,py,diePts)&&minEdgeDist(px,py,diePts)>=lr; if(shape==='circle') return Math.hypot(px-g.cx,py-g.cy)+lr<=g.r; return px>=g.x+lr&&px<=g.x+g.w-lr&&py>=g.y+lr&&py<=g.y+g.h-lr; }
  function isInsideBody(px,py){ if(shape==='diecut'&&diePts) return pointInPoly(px,py,diePts); if(shape==='circle') return Math.hypot(px-g.cx,py-g.cy)<=g.r; return px>=g.x&&px<=g.x+g.w&&py>=g.y&&py<=g.y+g.h; }
  function edgeAnchor(px,py){ if(shape==='diecut'&&diePts){ var a=nearestOnPoly(px,py,diePts); return {x:a.x,y:a.y,ang:Math.atan2(py-a.y,px-a.x)}; } if(shape==='circle'){ var an=Math.atan2(py-g.cy,px-g.cx); return {x:g.cx+Math.cos(an)*g.r,y:g.cy+Math.sin(an)*g.r,ang:an}; } var x2=g.x+g.w,y2=g.y+g.h,cs=[{x:Math.max(g.x,Math.min(x2,px)),y:g.y},{x:Math.max(g.x,Math.min(x2,px)),y:y2},{x:g.x,y:Math.max(g.y,Math.min(y2,py))},{x:x2,y:Math.max(g.y,Math.min(y2,py))}],be=cs[0],bd=1e18; for(var k=0;k<cs.length;k++){var dd=(px-cs[k].x)*(px-cs[k].x)+(py-cs[k].y)*(py-cs[k].y); if(dd<bd){bd=dd;be=cs[k];}} return {x:be.x,y:be.y,ang:Math.atan2(py-be.y,px-be.x)}; }

  // 穴まわりの補強。withNeck=true:首付きツメ（外付け）／false:丸い膨らみのみ（本体内・縁近く）
  function buildTab(withNeck){
    var a=edgeAnchor(hx,hy), an=a.ang;   // 最近点→穴（辺に直角）
    var neckW=lugR*2, rootX=a.x-Math.cos(an)*lugR, rootY=a.y-Math.sin(an)*lugR;   // 首＝ディスク直径（従来の首と同じ太さ）
    var BORDER='rgba(255,255,255,.30)';
    var tc=document.createElement('canvas'); tc.width=aw; tc.height=ah;
    var t=tc.getContext('2d'); t.lineCap='round'; t.lineJoin='round';
    if(withNeck){ t.strokeStyle=BORDER; t.lineWidth=neckW+3; t.beginPath(); t.moveTo(rootX,rootY); t.lineTo(hx,hy); t.stroke(); }
    t.fillStyle=BORDER; t.beginPath(); t.arc(hx,hy,lugR+1.5,0,Math.PI*2); t.fill();
    if(withNeck){ t.strokeStyle=acryl; t.lineWidth=neckW; t.beginPath(); t.moveTo(rootX,rootY); t.lineTo(hx,hy); t.stroke(); }
    t.fillStyle=acryl; t.beginPath(); t.arc(hx,hy,lugR,0,Math.PI*2); t.fill();
    if(!(ORDER.shape==='diecut' && ORDER.dieReinforce===false)){ t.globalCompositeOperation='destination-out'; t.fillStyle='#000'; bodyPath(t); t.fill(); t.globalCompositeOperation='source-over'; }
    return tc;
  }

  // 本体・画像・縁取りの描画（旧 draw(img, blank) 相当）
  ctx.clearRect(0,0,aw,ah);
  ctx.fillStyle=WRAP_BG; ctx.fillRect(0,0,aw,ah);
  if(!isInsideBody(hx,hy)) ctx.drawImage(buildTab(true),0,0,aw,ah);             // 外付け：首付きツメ
  else if(!lugFullyInside(hx,hy,lugR)) ctx.drawImage(buildTab(false),0,0,aw,ah); // 本体内・縁近く：丸い膨らみのみ
  if(shape==='diecut' && ORDER.dieReinforce===false && img){
    // 折れ防止OFF：画像のアルファに沿って縁取り＋穴抜き（無地のときは画像を重ねない）
    drawDieBodyAlpha(ctx, img, g.x, g.y, g.size, acryl, dieBorderPx(g.size), !blank);
  } else {
    ctx.save(); bodyPath(ctx); ctx.clip();
    if(shape==='diecut'&&diePts){ ctx.fillStyle=acryl; ctx.fill(); }
    if(img && !blank){ var ir=img.naturalWidth/img.naturalHeight, br=g.w/g.h, dw,dh,dx,dy; if(ir>br){dh=g.h;dw=dh*ir;dx=g.x-(dw-g.w)/2;dy=g.y;} else {dw=g.w;dh=dw/ir;dy=g.y-(dh-g.h)/2;dx=g.x;} ctx.drawImage(img,dx,dy,dw,dh); }
    else if(shape!=='diecut'){ ctx.fillStyle=acryl; ctx.fill(); }
    ctx.restore();
    if(!(shape==='diecut' && ORDER.dieReinforce===false)){ ctx.strokeStyle='rgba(255,255,255,.30)'; ctx.lineWidth=1.5; bodyPath(ctx); ctx.stroke(); }
  }
  // 取り付け穴を黒く抜く
  ctx.beginPath(); ctx.arc(hx,hy,holeR,0,Math.PI*2); ctx.fillStyle=WRAP_BG; ctx.fill();
  ctx.lineWidth=1.4; ctx.strokeStyle='rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(hx,hy,holeR,0,Math.PI*2); ctx.stroke();
  ctx.lineWidth=1; ctx.strokeStyle='rgba(255,255,255,.22)'; ctx.beginPath(); ctx.arc(hx,hy,Math.max(1,holeR-1.4),0,Math.PI*2); ctx.stroke();
}
(function(){
  var attX = (ORDER.attX!=null ? ORDER.attX : 50);
  var attY = (ORDER.attY!=null ? ORDER.attY : 10);
  var holeInfo = 'X: <strong>'+Math.round(attX)+'%</strong><br>Y: <strong>'+Math.round(attY)+'%</strong><br>状態: <strong>'+(ORDER.attMode==='outside'?'外付けツメ':'本体内')+'</strong><br>穴径: <strong>5mm</strong>';
  var holeImg = null, holeBlank = true;
  var cv = document.getElementById('attachCv');
  // 拡大登録（クリック時に最新の状態で再描画）
  ZOOM_HOLE = { label: '穴の位置（拡大）', info: holeInfo, paint: function(tcv,scale){ paintHole(tcv,scale,holeImg,holeBlank); } };
  var backNoPrint = (ORDER.attachView==='back' && !ORDER.imgBack);   // 裏面・印刷なし
  var contentSrc  = backNoPrint ? null : ((ORDER.attachView==='back' ? ORDER.imgBack : ORDER.imgFront) || ORDER.imgFront);
  var loadSrc     = contentSrc || (ORDER.shape==='diecut' ? ORDER.imgFront : null);   // 無地でもシルエット用に表画像を読む
  function render(img, blank){ holeImg=img; holeBlank=blank; if(cv) paintHole(cv,1,img,blank); }
  if(loadSrc){ var i=new Image(); i.onload=function(){render(i, !contentSrc);}; i.onerror=function(){render(null, true);}; i.src=loadSrc; }
  else render(null, true);
})();
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════
// 管理画面 HTML
// ═══════════════════════════════════════════════
function adminHTML() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NFC管理画面</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap');
:root{
  --ink:#1a1d23;--paper:#f6f7f9;--cream:#eef1f4;--accent:#3257d6;--accent-press:#2543b0;
  --muted:#6b7280;--border:#e4e7ec;--radius:10px;
  --green:#15803d;--blue:#3257d6;--blue-bg:#eef2fe;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans JP',sans-serif;background:var(--paper);color:var(--ink);min-height:100vh;}
.topbar{background:var(--ink);padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:10px;}
.logo{font-family:'Inter',sans-serif;font-weight:700;font-size:18px;color:#fff;letter-spacing:.02em;}
.topbar-right{display:flex;align-items:center;gap:8px;}
.nav-btn{font-size:12px;color:rgba(255,255,255,.6);background:none;border:1px solid rgba(255,255,255,.2);padding:5px 12px;border-radius:20px;cursor:pointer;font-family:'Noto Sans JP',sans-serif;}
.nav-btn:hover{color:#fff;border-color:rgba(255,255,255,.5);}

/* ── ログイン ── */
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:90vh;padding:20px;}
.login-card{background:#fff;border-radius:var(--radius);border:1.5px solid var(--border);padding:32px 28px;width:100%;max-width:360px;}
.login-title{font-family:'Inter',sans-serif;font-size:20px;font-weight:700;margin-bottom:6px;}
.login-sub{font-size:12px;color:var(--muted);margin-bottom:24px;}
.login-card input{width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:15px;font-family:'Noto Sans JP',sans-serif;outline:none;margin-bottom:12px;}
.login-card input:focus{border-color:var(--accent);}
.keep-login{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);margin-bottom:14px;cursor:pointer;user-select:none;}
.keep-login input{width:auto;margin:0;cursor:pointer;}
.login-btn{width:100%;padding:13px;background:var(--ink);border:none;border-radius:10px;color:#fff;font-family:'Noto Sans JP',sans-serif;font-size:14px;font-weight:500;cursor:pointer;}
.login-btn:hover{background:#333;}
.login-err{font-size:12px;color:var(--accent);margin-top:8px;display:none;}

/* ── 共通レイアウト ── */
.wrap{max-width:900px;margin:0 auto;padding:24px 16px;}
.section-title{font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;}

/* ── ホーム ── */
.home-hello{font-family:'Inter',sans-serif;font-size:22px;font-weight:700;margin-bottom:4px;}
.home-sub{font-size:13px;color:var(--muted);margin-bottom:24px;}
.menu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:24px;}
.menu-card{background:#fff;border:1.5px solid var(--border);border-radius:var(--radius);padding:22px;cursor:pointer;transition:all .15s;text-align:left;}
.menu-card:hover{border-color:var(--ink);transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.06);}
.menu-icon{font-size:30px;margin-bottom:10px;}
.menu-name{font-size:16px;font-weight:700;margin-bottom:4px;}
.menu-desc{font-size:12px;color:var(--muted);line-height:1.6;}

/* ── 検索・並び替え ── */
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px;}
.search-box{flex:1;min-width:200px;display:flex;align-items:center;gap:8px;background:#fff;border:1.5px solid var(--border);border-radius:10px;padding:0 12px;}
.search-box input{flex:1;border:none;outline:none;padding:11px 0;font-size:14px;font-family:'Noto Sans JP',sans-serif;background:transparent;}
.sort-select{padding:11px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;font-family:'Noto Sans JP',sans-serif;background:#fff;cursor:pointer;outline:none;}
.reload-btn{padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;background:#fff;cursor:pointer;font-size:12px;color:var(--ink);white-space:nowrap;}
.reload-btn:hover{border-color:var(--ink);}

/* ── 手動登録フォーム ── */
.add-card{background:#fff;border-radius:var(--radius);border:1.5px solid var(--border);padding:18px;margin-bottom:20px;}
.add-row{display:flex;gap:8px;flex-wrap:wrap;}
.add-row input{flex:1;min-width:120px;padding:10px 12px;border:1.5px solid var(--border);border-radius:9px;font-size:13px;font-family:'Noto Sans JP',sans-serif;outline:none;}
.add-row input:focus{border-color:var(--accent);}
.add-btn{padding:10px 18px;background:var(--accent);border:none;border-radius:9px;color:#fff;font-family:'Noto Sans JP',sans-serif;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;}
.add-btn:hover{background:var(--accent-press);}
.add-label{font-size:11px;color:var(--muted);margin-bottom:5px;display:block;}

/* ── テーブル ── */
.table-wrap{overflow-x:auto;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{background:#f3f4f6;color:#6b7280;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:11px 12px;text-align:left;white-space:nowrap;border-bottom:1px solid var(--border);}
td{padding:11px 12px;border-bottom:1px solid var(--cream);vertical-align:middle;}
tr:hover td{background:#f7f9fb;}
.order-id{font-family:monospace;font-size:12px;background:var(--cream);padding:2px 7px;border-radius:4px;}
.url-cell{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.url-cell a{color:var(--accent);text-decoration:none;font-size:12px;}
.url-cell a:hover{text-decoration:underline;}
.count-badge{display:inline-block;background:var(--blue-bg);color:var(--blue);font-size:11px;padding:1px 7px;border-radius:10px;font-weight:500;}
.date-cell{font-size:11px;color:var(--muted);white-space:nowrap;}
.edit-btn{padding:5px 11px;border:1.5px solid var(--border);border-radius:7px;background:#fff;cursor:pointer;font-size:12px;color:var(--ink);}
.edit-btn:hover{border-color:var(--ink);}
.del-btn{padding:5px 11px;border:1.5px solid #fecaca;border-radius:7px;background:#fff;cursor:pointer;font-size:12px;color:#dc2626;}
.del-btn:hover{background:#fee2e2;}
.nfc-link{font-size:11px;color:var(--muted);margin-top:3px;word-break:break-all;}
.nfc-link a{color:var(--accent);}
.copy-btn{font-size:11px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:#fff;cursor:pointer;margin-left:4px;}
.copy-btn:hover{background:var(--cream);}

/* ── URL一覧モーダル ── */
.ul-row{padding:10px 0;border-bottom:1px solid var(--cream);}
.ul-row:last-child{border-bottom:none;}
.ul-label{font-size:12px;font-weight:600;color:var(--ink);margin-bottom:3px;}
.ul-url{font-size:11px;color:var(--muted);word-break:break-all;margin-bottom:6px;font-family:monospace;}
.ul-url a{color:var(--accent);text-decoration:none;}
.ul-url a:hover{text-decoration:underline;}
.ul-actions{display:flex;gap:6px;flex-wrap:wrap;}
.ul-actions .copy-btn{margin-left:0;}

/* ── サポート ── */
.badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;}
.badge.open{background:#eef2fe;color:#3257d6;}
.badge.resolved{background:#e7f6ec;color:#15803d;}
.sup-row{background:#fff;border:1.5px solid var(--border);border-radius:10px;padding:13px 15px;margin-bottom:10px;cursor:pointer;transition:border-color .15s;}
.sup-row:hover{border-color:var(--ink);}
.sup-row-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px;}
.sup-row-subj{font-size:15px;font-weight:700;word-break:break-all;}
.sup-row-sub{font-size:11px;color:var(--muted);word-break:break-all;}
.sup-bw{display:flex;flex-direction:column;max-width:84%;margin-bottom:6px;}
.sup-bw.admin{align-self:flex-end;align-items:flex-end;}
.sup-bw.user{align-self:flex-start;align-items:flex-start;}
.sup-bub{padding:8px 12px;border-radius:13px;font-size:13.5px;line-height:1.6;word-break:break-all;white-space:pre-wrap;}
.sup-bub.admin{background:#3257d6;color:#fff;border-bottom-right-radius:4px;}
.sup-bub.user{background:#f1f3f6;color:var(--ink);border-bottom-left-radius:4px;}
.sup-bt{font-size:10px;color:var(--muted);margin:2px 4px 0;}

/* ── 編集モーダル ── */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;align-items:center;justify-content:center;padding:20px;}
.modal-bg.open{display:flex;}
.modal{background:#fff;border-radius:var(--radius);padding:24px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;}
.modal h3{font-size:16px;font-weight:700;margin-bottom:16px;}
.modal label{font-size:11px;color:var(--muted);display:block;margin-bottom:5px;margin-top:12px;text-transform:uppercase;letter-spacing:.05em;}
.modal input{width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;font-family:'Noto Sans JP',sans-serif;outline:none;}
.modal input:focus{border-color:var(--accent);}
.modal-foot{display:flex;gap:8px;margin-top:18px;}
.modal-cancel{flex:1;padding:11px;border:1.5px solid var(--border);border-radius:9px;background:transparent;cursor:pointer;font-family:'Noto Sans JP',sans-serif;font-size:13px;}
.modal-save{flex:1;padding:11px;background:var(--accent);border:none;border-radius:9px;color:#fff;font-family:'Noto Sans JP',sans-serif;font-size:13px;font-weight:500;cursor:pointer;}

/* 履歴ブロック */
.hist-block{margin-top:16px;background:#f8f9fb;border:1px solid var(--cream);border-radius:9px;padding:12px;}
.hist-head{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;}
.hist-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--cream);}
.hist-item:last-child{border-bottom:none;}
.hist-url{font-size:11px;color:var(--ink);word-break:break-all;flex:1;}
.hist-date{font-size:10px;color:var(--muted);}
.hist-restore{font-size:11px;padding:3px 9px;border:1px solid var(--blue);border-radius:5px;background:var(--blue-bg);color:var(--blue);cursor:pointer;white-space:nowrap;}
.hist-restore:hover{background:#d6ebfa;}
.hist-empty{font-size:11px;color:var(--muted);padding:4px 0;}

/* ── 在庫管理 ── */
.inv-card{background:#fff;border-radius:var(--radius);border:1.5px solid var(--border);margin-bottom:16px;overflow:hidden;}
.inv-card-head{padding:12px 16px;background:var(--cream);border-bottom:1px solid var(--border);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
.inv-card-body{padding:16px;}
.maint-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.toggle-wrap{display:flex;align-items:center;gap:10px;}
.toggle{position:relative;width:48px;height:26px;flex-shrink:0;}
.toggle input{opacity:0;width:0;height:0;}
.toggle-slider{position:absolute;inset:0;background:#ccc;border-radius:13px;cursor:pointer;transition:.2s;}
.toggle-slider::before{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;}
.toggle input:checked + .toggle-slider{background:#e84040;}
.toggle input:checked + .toggle-slider::before{transform:translateX(22px);}
.toggle-label{font-size:13px;font-weight:500;}
.maint-msg-wrap{flex:1;min-width:200px;}
.maint-msg-wrap input{width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:9px;font-size:13px;font-family:'Noto Sans JP',sans-serif;outline:none;}
.maint-msg-wrap input:focus{border-color:var(--accent);}
.color-inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;}
.color-inv-item{background:var(--paper);border:1.5px solid var(--border);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;}
.color-inv-swatch{width:36px;height:36px;border-radius:8px;border:2px solid rgba(0,0,0,.1);}
.color-inv-name{font-size:13px;font-weight:500;}
.color-inv-controls{display:flex;flex-direction:column;gap:6px;}
.inv-toggle-row{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted);}
.status-ok{display:inline-block;font-size:10px;padding:2px 8px;background:#dcfce7;color:#15803d;border-radius:10px;font-weight:600;}
.status-sold{display:inline-block;font-size:10px;padding:2px 8px;background:#fee2e2;color:#dc2626;border-radius:10px;font-weight:600;}
.status-hidden{display:inline-block;font-size:10px;padding:2px 8px;background:#ffe4bc;color:#c07000;border-radius:10px;font-weight:600;}
.save-inv-btn{padding:11px 24px;background:var(--accent);border:none;border-radius:9px;color:#fff;font-family:'Noto Sans JP',sans-serif;font-size:13px;font-weight:500;cursor:pointer;}
.save-inv-btn:hover{background:var(--accent-press);}
.save-inv-btn:disabled{background:#ccc;cursor:default;}

/* ── バックアップ ── */
.backup-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;}
.backup-btn{flex:1;min-width:130px;padding:14px;border-radius:10px;font-family:'Noto Sans JP',sans-serif;font-size:14px;font-weight:500;cursor:pointer;border:1.5px solid var(--border);background:#fff;}
.backup-btn.primary{background:var(--ink);color:#fff;border-color:var(--ink);}
.backup-btn:hover{opacity:.88;}
.backup-note{font-size:12px;color:var(--muted);line-height:1.7;margin-top:12px;}
.warn-note{font-size:12px;color:#b45309;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;margin-top:10px;line-height:1.6;}

.empty{text-align:center;padding:40px;color:var(--muted);font-size:13px;}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(8px);background:var(--ink);color:#fff;padding:9px 18px;border-radius:30px;font-size:13px;opacity:0;pointer-events:none;transition:all .25s;white-space:nowrap;z-index:200;}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
</style>
</head>
<body>

<!-- ===== ログイン ===== -->
<div id="loginView">
  <div class="topbar"><div class="logo">NFC ADMIN</div></div>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-title">管理画面ログイン</div>
      <div class="login-sub">パスワードを入力してください</div>
      <input type="password" id="pwInput" placeholder="パスワード" onkeydown="if(event.key==='Enter')doLogin()">
      <label class="keep-login"><input type="checkbox" id="keepLogin" checked> ログイン状態を保持する（この端末）</label>
      <button class="login-btn" onclick="doLogin()">ログイン &rarr;</button>
      <div class="login-err" id="loginErr">パスワードが違います</div>
    </div>
  </div>
</div>

<!-- ===== アプリ本体 ===== -->
<div id="appView" style="display:none;">
  <div class="topbar">
    <div class="logo">NFC ADMIN</div>
    <div class="topbar-right">
      <button class="nav-btn" id="homeNavBtn" onclick="showHome()" style="display:none;">&larr; ホーム</button>
      <button class="nav-btn" onclick="doLogout()">ログアウト</button>
    </div>
  </div>

  <!-- ホーム画面 -->
  <div id="homeView" class="wrap">
    <div class="home-hello">ホーム</div>
    <div class="home-sub">管理メニューを選んでください。</div>
    <div class="menu-grid">
      <button class="menu-card" onclick="showKeychains()">
        <div class="menu-icon">🔑</div>
        <div class="menu-name">キーホルダー</div>
        <div class="menu-desc">注文一覧・NFC / QR のリンク先設定・変更履歴の確認</div>
      </button>
      <button class="menu-card" onclick="showQrGen()">
        <div class="menu-icon">🏷️</div>
        <div class="menu-name">QRコード生成</div>
        <div class="menu-desc">注文番号から OPP袋用・商品本体用の QR を生成（注文がまだ無くても作れます）</div>
      </button>
      <button class="menu-card" onclick="showInventory()">
        <div class="menu-icon">📦</div>
        <div class="menu-name">在庫・メンテナンス</div>
        <div class="menu-desc">カラーの在庫切れ設定・注文フォームのメンテナンスモード</div>
      </button>
      <button class="menu-card" onclick="showBackup()">
        <div class="menu-icon">💾</div>
        <div class="menu-name">バックアップ</div>
        <div class="menu-desc">全データの書き出し（エクスポート）と復元（インポート）</div>
      </button>
      <button class="menu-card" onclick="showOptStock()">
        <div class="menu-icon">🧩</div>
        <div class="menu-name">オプション在庫</div>
        <div class="menu-desc">単体購入されたオプションの注文一覧・使用済み / 未使用の切り替え</div>
      </button>
      <button class="menu-card" onclick="showMessages()">
        <div class="menu-icon">✉️</div>
        <div class="menu-name">メッセージ一覧</div>
        <div class="menu-desc">お問い合わせフォームから届いたメッセージの確認・既読 / 削除</div>
      </button>
      <button class="menu-card" onclick="showSupport()">
        <div class="menu-icon">🎫</div>
        <div class="menu-name">サポート</div>
        <div class="menu-desc">お客さんからのサポートの一覧・チャットでの返信・解決済みの管理</div>
      </button>
      <button class="menu-card" onclick="showSelfOpt()">
        <div class="menu-icon">⚙️</div>
        <div class="menu-name">自己登録の設定</div>
        <div class="menu-desc">自己登録ページから作る番号に最初から付けるオプションの設定</div>
      </button>
    </div>
  </div>

  <!-- キーホルダー一覧画面 -->
  <div id="keychainsView" class="wrap" style="display:none;">
    <div class="section-title" style="margin-top:4px;">キーホルダー一覧</div>
    <div class="controls">
      <div class="search-box">
        <span>🔍</span>
        <input type="text" id="searchInput" placeholder="注文番号・メモで検索" oninput="renderList()">
      </div>
      <select class="sort-select" id="sortSelect" onchange="renderList()">
        <option value="reg_desc">登録が新しい順</option>
        <option value="reg_asc">登録が古い順</option>
        <option value="upd_desc">更新が新しい順</option>
        <option value="upd_asc">更新が古い順</option>
      </select>
      <button class="reload-btn" onclick="loadList()">↺ 更新</button>
    </div>

    <div class="section-title">NFC URL を手動登録</div>
    <div class="add-card">
      <div class="add-row">
        <div style="flex:1;min-width:120px;">
          <span class="add-label">注文番号</span>
          <input type="text" id="addOrderId" placeholder="O-XXXXXXXX">
        </div>
        <div style="flex:2;min-width:200px;">
          <span class="add-label">リダイレクト先URL</span>
          <input type="url" id="addUrl" placeholder="https://twitter.com/...">
        </div>
        <div style="flex:1;min-width:100px;">
          <span class="add-label">メモ（任意）</span>
          <input type="text" id="addLabel" placeholder="○○さん">
        </div>
        <div style="display:flex;align-items:flex-end;">
          <button class="add-btn" onclick="addEntry()">登録</button>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>注文番号</th>
            <th>メモ</th>
            <th>最終更新</th>
            <th>アクセス</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="listBody">
          <tr><td colspan="5" class="empty">読み込み中...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 在庫・メンテナンス画面 -->
  <div id="inventoryView" class="wrap" style="display:none;">
    <div class="section-title">在庫・メンテナンス管理</div>

    <!-- メンテナンスモード -->
    <div class="inv-card">
      <div class="inv-card-head">🚧 メンテナンスモード</div>
      <div class="inv-card-body">
        <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          ONにすると注文フォーム（page2）にメンテナンスバナーが表示され、注文送信がブロックされます。
        </p>
        <div class="maint-row">
          <div class="toggle-wrap">
            <label class="toggle">
              <input type="checkbox" id="maintToggle">
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label" id="maintLabel">OFF（通常営業中）</span>
          </div>
          <div class="maint-msg-wrap">
            <input type="text" id="maintMsg" placeholder="メンテナンス中メッセージ（例：現在準備中です）" maxlength="100">
          </div>
        </div>
      </div>
    </div>

    <!-- カラー在庫 -->
    <div class="inv-card">
      <div class="inv-card-head">🎨 カラー在庫状態</div>
      <div class="inv-card-body">
        <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">
          在庫切れにすると注文画面でその色にバッジが表示され選択できなくなります。「非表示」にすると選択肢ごと消えます。
        </p>
        <div class="color-inv-grid" id="colorInvGrid"></div>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;margin-top:8px;">
      <button class="save-inv-btn" id="saveInvBtn" onclick="saveInventory()">在庫設定を保存する</button>
    </div>
  </div>

  <!-- バックアップ画面 -->
  <div id="backupView" class="wrap" style="display:none;">
    <div class="section-title">バックアップ</div>
    <div class="inv-card">
      <div class="inv-card-head">💾 データのエクスポート／インポート</div>
      <div class="inv-card-body">
        <div class="backup-note">
          すべての注文・NFC・QR・履歴データをまとめて書き出し／復元できます。定期的にエクスポートして保存しておくことをおすすめします。
        </div>
        <div class="backup-row">
          <button class="backup-btn primary" onclick="doExport()">⬇ エクスポート（書き出し）</button>
          <button class="backup-btn" onclick="document.getElementById('importFile').click()">⬆ インポート（復元）</button>
          <input type="file" id="importFile" accept="application/json,.json" style="display:none;" onchange="doImport(event)">
        </div>
        <div class="warn-note">
          ⚠️ インポートは同じ注文番号のデータを上書きします。復元前に一度エクスポートしておくことをおすすめします。
        </div>
      </div>
    </div>
  </div>

  <!-- オプション在庫画面 -->
  <div id="optStockView" class="wrap" style="display:none;">
    <div class="section-title" style="margin-top:4px;">オプション在庫（単体購入されたオプション注文）</div>
    <div class="backup-note" style="margin-bottom:16px;">
      キーホルダー本体なしで「オプションだけ」を購入された注文の一覧です。お客さんが page4 で本体注文に紐付けると「使用済み」になります。
      トラブル対応のため、使用済み／未使用はここで手動で切り替えできます。
    </div>
    <div class="controls">
      <div class="search-box">
        <span>🔍</span>
        <input type="text" id="optSearchInput" placeholder="注文番号で検索" oninput="renderOptList()">
      </div>
      <button class="reload-btn" onclick="loadOptList()">↺ 更新</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>注文番号</th>
            <th>含まれるオプション</th>
            <th>追加枚数</th>
            <th>状態</th>
            <th>適用先</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="optListBody">
          <tr><td colspan="6" class="empty">読み込み中...</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <!-- メッセージ一覧画面 -->
  <style>
  .msg-card{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:12px;padding:14px 16px;margin-bottom:12px;}
  .msg-card.read{border-left-color:var(--muted);opacity:.66;}
  .msg-meta{display:flex;flex-wrap:wrap;gap:9px;align-items:center;font-size:11px;color:var(--muted);margin-bottom:8px;}
  .msg-badge{background:var(--accent);color:#fff;font-size:10px;padding:2px 9px;border-radius:10px;font-weight:700;}
  .msg-order{background:var(--sel);color:var(--accent);font-size:11px;padding:2px 9px;border-radius:8px;font-weight:700;}
  .msg-text{font-size:14px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:var(--ink);}
  .msg-contact{font-size:12px;color:var(--muted);margin-top:9px;}
  .msg-acts{display:flex;gap:8px;margin-top:13px;}
  .msg-acts .msgbtn{font-size:12px;padding:7px 15px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--ink);cursor:pointer;font-family:'Noto Sans JP',sans-serif;}
  .msg-acts .msgbtn:hover{border-color:var(--accent);}
  .msg-acts .del{color:var(--accent);}
  </style>
  <div id="messagesView" class="wrap" style="display:none;">
    <div class="section-title" style="margin-top:4px;">メッセージ一覧（お問い合わせ）</div>
    <div class="backup-note" style="margin-bottom:16px;">
      お問い合わせフォームから届いたメッセージです。未読は左に色が付きます。対応が済んだら「既読にする」、不要になったら「削除」できます。
    </div>
    <div class="controls">
      <button class="reload-btn" onclick="loadMessages()">↺ 更新</button>
    </div>
    <div id="msgListBox"><div class="empty">読み込み中...</div></div>
  </div>
</div>

  <!-- 自己登録のデフォルトオプション設定 -->
  <div id="selfOptView" class="wrap" style="display:none;">
    <div class="section-title" style="margin-top:4px;">自己登録ページのデフォルトオプション</div>
    <div class="backup-note" style="margin-bottom:16px;">
      自己登録ページ（友人・知人向け）から新しく登録される番号に、最初から対応済みにするオプションを設定します。<br>
      ここを変更しても、すでに登録済みの番号には影響しません（登録した時点の設定が各番号に保存されます）。
    </div>
    <div class="inv-card">
      <div class="inv-card-head">⚙️ 新規番号のデフォルト</div>
      <div class="inv-card-body">
        <div class="toggle-wrap" style="margin:10px 0;">
          <label class="toggle"><input type="checkbox" id="selfNfc"><span class="toggle-slider"></span></label>
          <span class="toggle-label">NFCタグを対応済みにする</span>
        </div>
        <div class="toggle-wrap" style="margin:10px 0;">
          <label class="toggle"><input type="checkbox" id="selfDouble"><span class="toggle-slider"></span></label>
          <span class="toggle-label">両面印刷を対応済みにする</span>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:10px 0 0;">※ ダイカット（輪郭カット）は標準で常に利用できます。</p>
        <div style="margin-top:14px;"><button class="reload-btn" onclick="saveSelfOpt()">💾 設定を保存</button>
        <span id="selfOptMsg" style="font-size:12px;color:var(--accent);margin-left:10px;"></span></div>
      </div>
    </div>
  </div>

  <!-- QRコード生成（注文番号から・注文が無くても作れる） -->
  <div id="qrGenView" class="wrap" style="display:none;">
    <div class="section-title" style="margin-top:4px;">QRコード生成</div>
    <div class="backup-note" style="margin-bottom:16px;">
      注文番号を入力すると、OPP袋用・商品本体用の QRコードをその場で生成・保存できます。<br>
      注文がまだ届いていなくても作れるので、袋や商品への貼り付け用に先に印刷しておけます。
    </div>
    <div class="add-card">
      <div class="add-row">
        <div style="flex:1;min-width:160px;">
          <span class="add-label">注文番号</span>
          <input type="text" id="qrGenOrderId" placeholder="例：83044766" onkeydown="if(event.key==='Enter')genQrCodes()">
        </div>
        <div style="display:flex;align-items:flex-end;">
          <button class="add-btn" onclick="genQrCodes()">QRを生成</button>
        </div>
      </div>
    </div>

    <div id="qrGenResult" style="display:none;">
      <div class="inv-card">
        <div class="inv-card-head">📦 OPP袋用QRコード</div>
        <div class="inv-card-body" style="text-align:center;">
          <div id="qrGenSetup" style="display:inline-block;padding:10px;background:#fff;border:1px solid var(--border);border-radius:10px;"></div>
          <div style="font-size:12px;color:var(--muted);margin:10px auto;line-height:1.7;max-width:360px;">袋に貼り付けるQRです。お客様が読み込むとURL変更ページが開き、この注文番号が自動で追加されます。</div>
          <div id="qrGenSetupUrl" style="font-size:11px;color:var(--muted);word-break:break-all;margin-bottom:10px;"></div>
          <button class="add-btn" onclick="dlQr('qrGenSetup','setup')">⬇ QRコードを保存</button>
        </div>
      </div>
      <div class="inv-card">
        <div class="inv-card-head">📲 商品本体用QRコード</div>
        <div class="inv-card-body" style="text-align:center;">
          <div id="qrGenProduct" style="display:inline-block;padding:10px;background:#fff;border:1px solid var(--border);border-radius:10px;"></div>
          <div style="font-size:12px;color:var(--muted);margin:10px auto;line-height:1.7;max-width:360px;">商品に印刷・貼り付けるQRです。お客様が読み込むと登録されたURLが開きます（マイページで変更可能）。</div>
          <div id="qrGenProductUrl" style="font-size:11px;color:var(--muted);word-break:break-all;margin-bottom:10px;"></div>
          <button class="add-btn" onclick="dlQr('qrGenProduct','product')">⬇ QRコードを保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- サポート画面 -->
  <div id="supportView" class="wrap" style="display:none;">
    <div class="section-title" style="margin-top:4px;">サポート一覧</div>
    <div class="backup-note" style="margin-bottom:16px;">
      お客さんから届いたサポートです。カードをクリックするとチャットで返信できます。<br>
      こちらの返信から1週間お客さんの反応が無いものは、自動で「解決済み」になります。
    </div>
    <div class="controls"><button class="reload-btn" onclick="loadSupport()">↺ 更新</button></div>
    <div id="supListBox"><div class="empty">読み込み中...</div></div>
  </div>

<!-- ===== サポート返信モーダル ===== -->
<div class="modal-bg" id="supportModal">
  <div class="modal" style="max-width:560px;display:flex;flex-direction:column;max-height:90vh;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
      <div style="min-width:0;">
        <h3 id="supTitle" style="margin:0;word-break:break-all;">要件</h3>
        <div id="supNum" style="font-family:monospace;font-size:12px;color:var(--muted);margin-top:3px;"></div>
      </div>
      <button class="modal-cancel" style="flex:0 0 auto;width:auto;padding:7px 14px;" onclick="closeSupport()">閉じる</button>
    </div>
    <div id="supContact" style="font-size:12px;color:var(--muted);margin-top:8px;"></div>
    <div id="supDetail" style="font-size:13px;color:var(--ink);background:var(--cream);border-radius:8px;padding:10px;margin-top:8px;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow-y:auto;"></div>
    <div style="margin-top:10px;"><button class="edit-btn" id="supStatusBtn" onclick="toggleSupStatus()">解決済みにする</button></div>
    <div id="supChat" style="flex:1;overflow-y:auto;margin-top:12px;border-top:1px solid var(--cream);padding-top:12px;display:flex;flex-direction:column;gap:4px;min-height:160px;"></div>
    <div id="supReplyBar" style="display:flex;gap:8px;margin-top:10px;">
      <textarea id="supReply" rows="2" placeholder="返信を入力" style="flex:1;border:1.5px solid var(--border);border-radius:9px;padding:9px;font-family:inherit;font-size:14px;resize:none;outline:none;"></textarea>
      <button class="modal-save" style="flex:0 0 auto;width:auto;padding:0 18px;" onclick="sendSupReply()">送信</button>
    </div>
  </div>
</div>

<!-- ===== 編集モーダル ===== -->
<div class="modal-bg" id="editModal">
  <div class="modal">
    <h3>NFC / QR URL を編集</h3>
    <input type="hidden" id="editOrderId">
    <label>注文番号</label>
    <input type="text" id="editOrderIdDisp" disabled style="background:var(--cream);color:var(--muted);">
    <label>NFC リダイレクト先URL</label>
    <input type="url" id="editUrl" placeholder="https://...">
    <label>QRコード リダイレクト先URL</label>
    <input type="url" id="editQrUrl" placeholder="https://...">
    <label>メモ（任意）</label>
    <input type="text" id="editLabel" placeholder="○○さん">

    <!-- 購入オプションの手動編集 -->
    <!-- お客さんからの問い合わせ対応や、人にあげる番号の解錠に使う。 -->
    <!-- ここでチェックを入れると、page2 側でそのオプションが使えるようになる。 -->
    <div class="opt-edit-block" style="margin-top:16px;padding:12px;background:var(--cream);border-radius:10px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">🛒 購入オプション（手動で変更可）</div>
      <label class="opt-check" style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px;cursor:pointer;">
        <input type="checkbox" id="editOptNfc" style="width:18px;height:18px;cursor:pointer;"> NFCタグ
      </label>
      <label class="opt-check" style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px;cursor:pointer;">
        <input type="checkbox" id="editOptDouble" style="width:18px;height:18px;cursor:pointer;"> 両面印刷
      </label>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;">
        <span>2枚目以降（追加枚数）</span>
        <input type="number" id="editAddonCount" min="0" max="4" value="0" style="width:70px;padding:6px 8px;">
        <span style="color:var(--muted);">枚</span>
      </div>
    </div>

    <div class="nfc-link" id="editNfcLink" style="margin-top:6px;"></div>
    <div class="nfc-link" id="editQrLink" style="margin-top:4px;"></div>

    <!-- NFC URL 変更履歴 -->
    <div class="hist-block">
      <div class="hist-head">📜 NFC URL の変更履歴（最大3件）</div>
      <div id="nfcHistList"></div>
    </div>
    <!-- QR URL 変更履歴 -->
    <div class="hist-block">
      <div class="hist-head">📜 QR URL の変更履歴（最大3件）</div>
      <div id="qrHistList"></div>
    </div>

    <div class="modal-foot">
      <button class="modal-cancel" onclick="closeEdit()">キャンセル</button>
      <button class="modal-save" onclick="saveEdit()">保存</button>
    </div>
  </div>
</div>

<!-- ===== URL一覧モーダル ===== -->
<div class="modal-bg" id="urlListModal">
  <div class="modal">
    <h3 id="urlListTitle">URL一覧</h3>
    <div id="urlListRows"></div>

    <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;margin-top:18px;">
      <div style="text-align:center;">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">📦 自動登録QR（OPP袋用）</div>
        <div id="ulSetupQr" style="display:inline-block;background:#fff;padding:8px;border:1px solid var(--border);border-radius:8px;line-height:0;"></div>
        <div><button class="copy-btn" style="margin-top:8px;margin-left:0;" onclick="dlUlQr('ulSetupQr','setup')">⬇ 保存</button></div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">📲 注文のQR（商品本体用）</div>
        <div id="ulProductQr" style="display:inline-block;background:#fff;padding:8px;border:1px solid var(--border);border-radius:8px;line-height:0;"></div>
        <div><button class="copy-btn" style="margin-top:8px;margin-left:0;" onclick="dlUlQr('ulProductQr','product')">⬇ 保存</button></div>
      </div>
    </div>

    <div class="modal-foot">
      <button class="modal-cancel" onclick="closeUrlList()">閉じる</button>
      <button class="modal-save" onclick="dlUrlListTxt()">⬇ URL一覧をテキスト保存</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
const BASE   = location.origin;
const LS_KEY = 'buki_admin_pw';
let PW = '';
let ALL_ITEMS  = [];   // /api/get-all の結果を保持
let CURRENT_EDIT = null; // 編集中アイテム（履歴復元用）

// カラー定義（page2 と合わせること）
const COLORS_DEF = [
  { name:'ホワイト', hex:'#FFFFFF', border:'#ccc' },
  { name:'ブラック', hex:'#1a1a18' },
  { name:'ブルー',   hex:'#2563EB' },
  { name:'イエロー', hex:'#FACC15' },
  { name:'オレンジ', hex:'#F97316' },
  { name:'レッド',   hex:'#EF4444' },
  { name:'グリーン', hex:'#22C55E' },
];

// ─── 起動時：保存済みパスワードで自動ログイン ───
window.addEventListener('DOMContentLoaded', function () {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    fetch(BASE + '/api/get-all', { headers: { Authorization: 'Bearer ' + saved } })
      .then(function (r) {
        if (r.ok) {
          PW = saved;
          enterApp();
          r.json().then(function (d) { ALL_ITEMS = d.items || []; });
        } else {
          localStorage.removeItem(LS_KEY);
        }
      }).catch(function(){});
  }
});

// ─── ログイン / ログアウト ───
function doLogin() {
  PW = document.getElementById('pwInput').value;
  if (!PW) return;
  const keep = document.getElementById('keepLogin').checked;
  fetch(BASE + '/api/get-all', { headers: { Authorization: 'Bearer ' + PW } })
    .then(function (r) {
      if (r.status === 401) {
        document.getElementById('loginErr').style.display = 'block';
        PW = '';
      } else if (!r.ok) {
        // 401以外の失敗（サーバーエラーなど）も知らせる
        document.getElementById('loginErr').style.display = 'block';
        document.getElementById('loginErr').textContent = 'ログインに失敗しました（コード ' + r.status + '）';
        PW = '';
      } else {
        if (keep) localStorage.setItem(LS_KEY, PW);
        else      localStorage.removeItem(LS_KEY);
        enterApp();
        r.json().then(function (d) { ALL_ITEMS = d.items || []; });
      }
    })
    .catch(function (e) {
      // 通信自体が失敗（URL違い・ネットワーク不通など）→ 無反応にせず表示する
      document.getElementById('loginErr').style.display = 'block';
      document.getElementById('loginErr').textContent = '通信エラー：サーバーに接続できません（' + BASE + '）';
      PW = '';
    });
}
function doLogout() {
  PW = ''; localStorage.removeItem(LS_KEY);
  document.getElementById('loginView').style.display = 'block';
  document.getElementById('appView').style.display   = 'none';
  document.getElementById('pwInput').value = '';
}
function enterApp() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('appView').style.display   = 'block';
  // URLハッシュがあればその画面を、無ければホームを表示（ブックマーク・再読み込み対応）
  if (location.hash && location.hash.slice(1)) adminRoute(false);
  else showHome();
}

// ─── 画面切り替え（各画面にURLハッシュを割り当て、ブラウザの戻る/進むで行き来できる）───
function hideAll() {
  ['homeView','keychainsView','inventoryView','backupView','optStockView','messagesView','selfOptView','qrGenView','supportView'].forEach(function(id){
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('homeNavBtn').style.display = 'none';
}
// 表示中の画面に対応するURL(#xxx)を履歴に積む。
// push===false（ブラウザの戻る/進む経由の呼び出し）のときは積まない＝二重登録を防ぐ。
function nav(view, push) {
  if (push === false) return;
  if (location.hash.slice(1) === view) return;   // 同じURLなら積まない
  history.pushState(null, '', '#' + view);
}
// URLハッシュ → 対応する画面表示関数。
var ADMIN_ROUTES = {
  home: showHome, keychains: showKeychains, inventory: showInventory, backup: showBackup,
  optstock: showOptStock, messages: showMessages, selfopt: showSelfOpt, qrgen: showQrGen,
  support: showSupport
};
// 現在のURLハッシュに合わせて画面を表示する。
function adminRoute(push) {
  var v = (location.hash.slice(1) || 'home').toLowerCase();
  (ADMIN_ROUTES[v] || showHome)(push);
}
// ブラウザの戻る/進む：ログイン後（アプリ表示中）のみ画面を切り替える。
window.addEventListener('popstate', function () {
  if (document.getElementById('appView').style.display !== 'none') adminRoute(false);
});

function showHome(push) {
  hideAll();
  document.getElementById('homeView').style.display = 'block';
  nav('home', push);
}
function showKeychains(push) {
  hideAll();
  document.getElementById('keychainsView').style.display = 'block';
  document.getElementById('homeNavBtn').style.display    = 'inline-block';
  loadList();
  nav('keychains', push);
}
function showInventory(push) {
  hideAll();
  document.getElementById('inventoryView').style.display = 'block';
  document.getElementById('homeNavBtn').style.display    = 'inline-block';
  loadInventory();
  nav('inventory', push);
}
function showBackup(push) {
  hideAll();
  document.getElementById('backupView').style.display = 'block';
  document.getElementById('homeNavBtn').style.display = 'inline-block';
  nav('backup', push);
}
function showOptStock(push) {
  hideAll();
  document.getElementById('optStockView').style.display = 'block';
  document.getElementById('homeNavBtn').style.display   = 'inline-block';
  loadOptList();
  nav('optstock', push);
}
function showMessages(push) {
  hideAll();
  document.getElementById('messagesView').style.display = 'block';
  document.getElementById('homeNavBtn').style.display   = 'inline-block';
  loadMessages();
  nav('messages', push);
}
function showSelfOpt(push) {
  hideAll();
  document.getElementById('selfOptView').style.display = 'block';
  document.getElementById('homeNavBtn').style.display  = 'inline-block';
  loadSelfOpt();
  nav('selfopt', push);
}

// ─── QRコード生成（注文番号から。注文が存在しなくても作れる）───
var QRGEN_ID = '';
function showQrGen(push) {
  hideAll();
  document.getElementById('qrGenView').style.display  = 'block';
  document.getElementById('homeNavBtn').style.display = 'inline-block';
  nav('qrgen', push);
}
function genQrCodes() {
  var id = (document.getElementById('qrGenOrderId').value || '').trim();
  if (!id) { alert('注文番号を入力してください'); return; }
  if (!window.QRCode) { alert('QR生成ライブラリの読み込みに失敗しました。通信環境を確認して再読み込みしてください。'); return; }
  QRGEN_ID = id;
  var setupUrl = BASE + '/setup/' + encodeURIComponent(id);   // OPP袋用：URL変更ページが開く
  var qrUrl    = BASE + '/qr/'    + encodeURIComponent(id);   // 商品本体用：登録URLへリダイレクト
  var sBox = document.getElementById('qrGenSetup');
  var pBox = document.getElementById('qrGenProduct');
  sBox.innerHTML = ''; pBox.innerHTML = '';
  new QRCode(sBox, { text: setupUrl, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  new QRCode(pBox, { text: qrUrl,    width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  document.getElementById('qrGenSetupUrl').textContent   = setupUrl;
  document.getElementById('qrGenProductUrl').textContent = qrUrl;
  document.getElementById('qrGenResult').style.display = 'block';
}
function dlQr(boxId, kind) {
  var box = document.getElementById(boxId);
  var im = box.querySelector('img') || box.querySelector('canvas');
  if (!im) return;
  var src = (im.tagName === 'IMG') ? im.src : im.toDataURL('image/png');
  saveImage(src, kind + '_qr_' + QRGEN_ID + '.png', 'QRコード');
}
function loadSelfOpt() {
  fetch(BASE + '/api/self-opt-get').then(function(r){ return r.json(); }).then(function(d){
    var o = (d && d.options) || {};
    document.getElementById('selfNfc').checked    = !!o.nfc;
    document.getElementById('selfDouble').checked = !!o.double;
  }).catch(function(){});
}
function saveSelfOpt() {
  var msg = document.getElementById('selfOptMsg');
  fetch(BASE + '/api/self-opt-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW },
    body: JSON.stringify({ nfc: document.getElementById('selfNfc').checked, double: document.getElementById('selfDouble').checked })
  }).then(function(r){ return r.json(); }).then(function(d){
    if (d && d.ok) { msg.textContent = '保存しました'; setTimeout(function(){ msg.textContent = ''; }, 2000); }
    else { msg.textContent = (d && d.error) || '保存に失敗しました'; }
  }).catch(function(){ msg.textContent = '通信エラー'; });
}
function loadMessages() {
  var box = document.getElementById('msgListBox');
  box.innerHTML = '<div class="empty">読み込み中...</div>';
  fetch(BASE + '/api/messages', { headers: { Authorization: 'Bearer ' + PW } })
    .then(function (r) { return r.json(); })
    .then(function (d) { renderMessages((d && d.items) ? d.items : []); })
    .catch(function () { box.innerHTML = '<div class="empty">読み込みに失敗しました</div>'; });
}
function renderMessages(items) {
  var box = document.getElementById('msgListBox');
  if (!items.length) { box.innerHTML = '<div class="empty">メッセージはまだありません</div>'; return; }
  var html = '';
  for (var i = 0; i < items.length; i++) {
    var m = items[i];
    html += '<div class="msg-card' + (m.read ? ' read' : '') + '">';
    html += '<div class="msg-meta">';
    if (!m.read) { html += '<span class="msg-badge">未読</span>'; }
    html += '<span>' + fmtDate(m.ts) + '</span>';
    if (m.order) { html += '<span class="msg-order">注文 ' + esc(m.order) + '</span>'; }
    html += '</div>';
    html += '<div class="msg-text">' + esc(m.text) + '</div>';
    if (m.contact) { html += '<div class="msg-contact">連絡先：' + esc(m.contact) + '</div>'; }
    html += '<div class="msg-acts">';
    html += '<button class="msgbtn mark" data-id="' + esc(m.id) + '" data-read="' + (m.read ? '1' : '0') + '">' + (m.read ? '未読に戻す' : '既読にする') + '</button>';
    html += '<button class="msgbtn del" data-id="' + esc(m.id) + '">削除</button>';
    html += '</div></div>';
  }
  box.innerHTML = html;
  box.onclick = function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'BUTTON') return;
    var id = t.getAttribute('data-id');
    if (t.className.indexOf('mark') !== -1) { markMsg(id, t.getAttribute('data-read') !== '1'); }
    else if (t.className.indexOf('del') !== -1) { delMsg(id); }
  };
}
function markMsg(id, read) {
  fetch(BASE + '/api/message-update', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW }, body: JSON.stringify({ id: id, read: read }) })
    .then(function () { loadMessages(); });
}
function delMsg(id) {
  if (!confirm('このメッセージを削除しますか？（元に戻せません）')) return;
  fetch(BASE + '/api/message-update', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW }, body: JSON.stringify({ id: id, delete: true }) })
    .then(function () { loadMessages(); });
}

// ─── 一覧読み込み ───
function loadList() {
  fetch(BASE + '/api/get-all', { headers: { Authorization: 'Bearer ' + PW } })
    .then(function (r) { return r.json(); })
    .then(function (d) { ALL_ITEMS = d.items || []; renderList(); })
    .catch(function () { toast('一覧の取得に失敗しました'); });
}

// ─── 画像の保存（スマホは「写真に保存」、PCはダウンロード）───
// スマホ(iPhone/iPad/Android)では Web Share でOSの共有シートを開き、「画像を保存」でカメラロールへ。
// 共有が使えない端末（多くのPC等）では従来どおりPNGダウンロードにフォールバックする。
function isMobileLike() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS（Mac偽装）対策
}
function dataUrlToBlob(d) {
  var head = d.split(',')[0], body = d.split(',')[1];
  var mime = head.substring(head.indexOf(':') + 1, head.indexOf(';'));
  var bin = atob(body), n = bin.length, u8 = new Uint8Array(n);
  for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}
function saveImage(dataUrl, filename, title) {
  if (isMobileLike() && navigator.canShare) {
    try {
      var file = new File([dataUrlToBlob(dataUrl)], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: title || filename }).catch(function () {});
        return; // 共有シートが開いた（ユーザーが「写真に保存」を選べる）
      }
    } catch (e) { /* 失敗時は下のダウンロードへ */ }
  }
  var a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

// ─── ラベル保存（注文番号専用QR入りの黒枠ラベルを生成して保存）───
function printLabel(oid) {
  if (!window.QRCode) { alert('QRライブラリの読み込み中です。少し待ってからもう一度押してください。'); return; }
  var setupUrl = location.origin + '/setup/' + encodeURIComponent(oid);
  var tmp = document.createElement('div');
  new QRCode(tmp, { text: setupUrl, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
  setTimeout(function () {
    var qrEl = tmp.querySelector('canvas') || tmp.querySelector('img');
    var cv = document.createElement('canvas'); cv.width = 930; cv.height = 300;
    var ctx = cv.getContext('2d'); var W = cv.width, H = cv.height, INK = '#000';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.strokeRect(5, 5, W - 10, H - 10);
    var q = 240; ctx.imageSmoothingEnabled = false; ctx.drawImage(qrEl, 34, (H - q) / 2, q, q);
    ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
    ctx.font = '900 80px sans-serif'; ctx.fillText('BUKI製作所', 322, 150);
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(326, 180); ctx.lineTo(900, 180); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = '700 46px sans-serif'; ctx.fillText('QRを読み取って登録', 326, 244);
    var dataUrl = cv.toDataURL('image/png');
    saveImage(dataUrl, 'label_' + oid + '.png', 'ラベル ' + oid);
  }, 80);
}

// ─── 一覧描画（検索フィルタ + 並び替え）───
function renderList() {
  const tbody = document.getElementById('listBody');
  const q     = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const sort  = document.getElementById('sortSelect').value;

  let items = ALL_ITEMS.filter(function (it) {
    if (!q) return true;
    return (it.orderId || '').toLowerCase().indexOf(q) >= 0
        || (it.label   || '').toLowerCase().indexOf(q) >= 0;
  });

  const t = function (v) { return v ? new Date(v).getTime() : 0; };
  items.sort(function (a, b) {
    if (sort === 'reg_desc') return t(b.registeredAt)  - t(a.registeredAt);
    if (sort === 'reg_asc')  return t(a.registeredAt)  - t(b.registeredAt);
    if (sort === 'upd_desc') return t(b.lastUrlUpdate) - t(a.lastUrlUpdate);
    if (sort === 'upd_asc')  return t(a.lastUrlUpdate) - t(b.lastUrlUpdate);
    return 0;
  });

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">' + (q ? '該当する注文がありません' : 'まだ登録がありません') + '</td></tr>';
    return;
  }

  let html = '';
  for (let i = 0; i < items.length; i++) {
    const item   = items[i];
    const oid    = item.orderId;
    const oidEnc = encodeURIComponent(oid);

    html += '<tr>';
    html += '<td>';
    html +=   '<span class="order-id">' + esc(oid) + '</span>';
    html += '</td>';
    html += '<td style="font-size:12px;color:var(--muted);">' + esc(item.label || '—') + '</td>';
    html += '<td class="date-cell">' + fmtDate(item.lastUrlUpdate) + '</td>';
    html += '<td><span class="count-badge">📡' + (item.accessCount||0) + ' / 📷' + (item.qrAccessCount||0) + '</span></td>';
    html += '<td style="white-space:nowrap;">';
    html +=   '<button class="edit-btn" onclick="openEdit(\\'' + esc(oid) + '\\')">編集</button> ';
    html +=   '<button class="del-btn"  onclick="deleteEntry(\\'' + esc(oid) + '\\')">削除</button> ';
    html +=   '<button class="edit-btn" style="background:var(--blue-bg);border-color:#b8d9f0;color:var(--blue);" onclick="window.open(\\'/order/' + oidEnc + '?pw=\\'+encodeURIComponent(PW),\\'_blank\\')">詳細</button> ';
    html +=   '<button class="edit-btn" onclick="printLabel(\\'' + esc(oid) + '\\')">ラベル保存</button> ';
    html +=   '<button class="edit-btn" style="background:#eef9f0;border-color:#bfe3c6;color:var(--green);" onclick="openUrlList(\\'' + esc(oid) + '\\')">URL一覧</button>';
    html += '</td>';
    html += '</tr>';
  }
  tbody.innerHTML = html;
}

// ─── 手動登録 ───
function addEntry() {
  const orderId = document.getElementById('addOrderId').value.trim();
  const url     = document.getElementById('addUrl').value.trim();
  const label   = document.getElementById('addLabel').value.trim();
  if (!orderId) { toast('注文番号を入力してください'); return; }
  fetch(BASE + '/api/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW },
    body: JSON.stringify({ orderId, url, label }),
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.ok) {
      toast('登録しました ✓');
      document.getElementById('addOrderId').value = '';
      document.getElementById('addUrl').value     = '';
      document.getElementById('addLabel').value   = '';
      loadList();
    } else { toast('エラー: ' + (d.error||'不明')); }
  });
}

// ─── 編集モーダル ───
function openEdit(orderId) {
  const item = ALL_ITEMS.find(function (x) { return x.orderId === orderId; });
  if (!item) { toast('データが見つかりません'); return; }
  CURRENT_EDIT = item;

  document.getElementById('editOrderId').value     = item.orderId;
  document.getElementById('editOrderIdDisp').value = item.orderId;
  document.getElementById('editUrl').value         = item.nfcUrl || '';
  document.getElementById('editQrUrl').value       = item.qrUrl  || '';
  document.getElementById('editLabel').value       = item.label  || '';
  document.getElementById('editNfcLink').innerHTML =
    'NFC: <a href="' + BASE + '/nfc/' + encodeURIComponent(item.orderId) + '" target="_blank">' + BASE + '/nfc/' + esc(item.orderId) + '</a>';
  document.getElementById('editQrLink').innerHTML =
    'QR: <a href="' + BASE + '/qr/' + encodeURIComponent(item.orderId) + '" target="_blank">' + BASE + '/qr/' + esc(item.orderId) + '</a>';

  document.getElementById('nfcHistList').innerHTML = histHTML(item.nfcHistory, 'nfc');
  document.getElementById('qrHistList').innerHTML  = histHTML(item.qrHistory,  'qr');

  // 購入オプションの現在値をチェックボックス・数値欄に反映
  var opt = item.options || {};
  document.getElementById('editOptNfc').checked    = !!opt.nfc;
  document.getElementById('editOptDouble').checked = !!opt.double;
  document.getElementById('editAddonCount').value  = item.addonCount || 0;

  document.getElementById('editModal').classList.add('open');
}

// 履歴リストの HTML 生成（kind: 'nfc' | 'qr'）
function histHTML(hist, kind) {
  if (!hist || !hist.length) return '<div class="hist-empty">変更履歴はまだありません</div>';
  let h = '';
  for (let i = 0; i < hist.length; i++) {
    const fn = kind === 'nfc' ? 'restoreNfc' : 'restoreQr';
    h += '<div class="hist-item">';
    h +=   '<div style="flex:1;">';
    h +=     '<div class="hist-url">' + esc(hist[i].url || '（空）') + '</div>';
    h +=     '<div class="hist-date">' + fmtDate(hist[i].at) + ' まで使用</div>';
    h +=   '</div>';
    h +=   '<button class="hist-restore" onclick="' + fn + '(' + i + ')">この URL に戻す</button>';
    h += '</div>';
  }
  return h;
}
function restoreNfc(i) {
  if (!CURRENT_EDIT || !CURRENT_EDIT.nfcHistory[i]) return;
  document.getElementById('editUrl').value = CURRENT_EDIT.nfcHistory[i].url || '';
  toast('履歴のURLを入力欄に入れました');
}
function restoreQr(i) {
  if (!CURRENT_EDIT || !CURRENT_EDIT.qrHistory[i]) return;
  document.getElementById('editQrUrl').value = CURRENT_EDIT.qrHistory[i].url || '';
  toast('履歴のURLを入力欄に入れました');
}

function closeEdit() { document.getElementById('editModal').classList.remove('open'); }

function saveEdit() {
  const orderId = document.getElementById('editOrderId').value;
  const url     = document.getElementById('editUrl').value.trim();
  const qrUrl   = document.getElementById('editQrUrl').value.trim();
  const label   = document.getElementById('editLabel').value.trim();
  // 購入オプションと追加枚数を収集
  const options = {
    nfc:    document.getElementById('editOptNfc').checked,
    double: document.getElementById('editOptDouble').checked,
  };
  const addonCount = parseInt(document.getElementById('editAddonCount').value, 10) || 0;
  fetch(BASE + '/api/set-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW },
    body: JSON.stringify({ orderId, nfcUrl: url, qrUrl, label, options, addonCount }),
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.ok) { toast('保存しました ✓'); closeEdit(); loadList(); }
    else      { toast('エラー: ' + (d.error||'不明')); }
  }).catch(function () { toast('通信エラーが発生しました'); });
}

// ─── オプション在庫 ───
var OPT_ITEMS = [];               // /api/opt-list の結果を保持
var OPT_LABELS = { nfc: 'NFCタグ', double: '両面印刷' };

function loadOptList() {
  fetch(BASE + '/api/opt-list', { headers: { Authorization: 'Bearer ' + PW } })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      OPT_ITEMS = (d && d.items) ? d.items : [];
      renderOptList();
    })
    .catch(function () {
      document.getElementById('optListBody').innerHTML =
        '<tr><td colspan="6" class="empty">読み込みに失敗しました</td></tr>';
    });
}

function renderOptList() {
  var kw = (document.getElementById('optSearchInput').value || '').trim();
  var rows = OPT_ITEMS.filter(function (it) {
    return !kw || (it.orderId && it.orderId.indexOf(kw) !== -1);
  });

  if (!rows.length) {
    document.getElementById('optListBody').innerHTML =
      '<tr><td colspan="6" class="empty">オプション在庫はまだありません</td></tr>';
    return;
  }

  document.getElementById('optListBody').innerHTML = rows.map(function (it) {
    // 含まれるオプションをタグで表示
    var opt = it.options || {};
    var tags = Object.keys(OPT_LABELS)
      .filter(function (k) { return opt[k]; })
      .map(function (k) { return '<span class="count-badge">' + OPT_LABELS[k] + '</span>'; })
      .join(' ');
    if (!tags) tags = '<span style="color:var(--muted);">—</span>';

    var addon = (it.addonCount || 0) > 0
      ? '<strong style="color:var(--accent);">' + it.addonCount + ' 枚</strong>'
      : '0 枚';

    var stateBadge = it.used
      ? '<span class="badge badge-no">使用済み</span>'
      : '<span class="badge badge-yes">未使用</span>';

    var usedFor = it.usedFor
      ? '<span style="font-family:monospace;font-size:12px;">' + esc(it.usedFor) + '</span>'
      : '<span style="color:var(--muted);">—</span>';

    // 使用済み/未使用を切り替えるボタン
    var btnLabel = it.used ? '未使用に戻す' : '使用済みにする';
    var btn = '<button class="edit-btn" onclick="toggleOptUsed(\\'' + esc(it.orderId) + '\\',' + (!it.used) + ')">' + btnLabel + '</button>';

    return '<tr>' +
      '<td><span class="order-id">' + esc(it.orderId) + '</span></td>' +
      '<td>' + tags + '</td>' +
      '<td>' + addon + '</td>' +
      '<td>' + stateBadge + '</td>' +
      '<td>' + usedFor + '</td>' +
      '<td style="white-space:nowrap;">' + btn + '</td>' +
      '</tr>';
  }).join('');
}

function toggleOptUsed(orderId, used) {
  var msg = used
    ? orderId + ' を「使用済み」にしますか？'
    : orderId + ' を「未使用」に戻しますか？\\n（適用先の記録もクリアされます）';
  if (!confirm(msg)) return;

  fetch(BASE + '/api/opt-set-used', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW },
    body: JSON.stringify({ orderId: orderId, used: used }),
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.ok) { toast('変更しました ✓'); loadOptList(); }
    else      { toast('エラー: ' + (d.error || '不明')); }
  }).catch(function () { toast('通信エラーが発生しました'); });
}

// ─── 削除 ───
function deleteEntry(orderId) {
  if (!confirm(orderId + ' を削除しますか？\\n（注文・NFC・QR・履歴すべて消えます）')) return;
  fetch(BASE + '/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW },
    body: JSON.stringify({ orderId }),
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.ok) { toast('削除しました'); loadList(); }
  });
}

// ─── 在庫管理 ───
document.getElementById('maintToggle').addEventListener('change', function () {
  const on = this.checked;
  document.getElementById('maintLabel').textContent = on ? 'ON（メンテナンス中）' : 'OFF（通常営業中）';
  document.getElementById('maintLabel').style.color = on ? '#e84040' : '';
});

async function loadInventory() {
  const r = await fetch(BASE + '/api/get-inventory');
  const d = await r.json();
  const inv = d.inventory || {};
  const chk = document.getElementById('maintToggle');
  chk.checked = !!inv.maintenance;
  chk.dispatchEvent(new Event('change'));
  document.getElementById('maintMsg').value = inv.maintenanceMsg || '';

  const colorStates = inv.colors || {};
  document.getElementById('colorInvGrid').innerHTML = COLORS_DEF.map(function (c) {
    const st = colorStates[c.name] || {};
    const isSold   = !!st.soldOut;
    const isHidden = !!st.hidden;
    const badge = isHidden
      ? '<span class="status-hidden">非表示</span>'
      : isSold
        ? '<span class="status-sold">在庫切れ</span>'
        : '<span class="status-ok">在庫あり</span>';
    return '<div class="color-inv-item">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<div class="color-inv-swatch" style="background:' + esc(c.hex) + ';' + (c.border?'border-color:'+c.border:'') + ';"></div>' +
        '<div><div class="color-inv-name">' + esc(c.name) + '</div>' +
          '<div id="cinv-badge-' + esc(c.name) + '" style="margin-top:3px;">' + badge + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="color-inv-controls">' +
        '<div class="inv-toggle-row"><span>在庫切れ</span>' +
          '<label class="toggle"><input type="checkbox" id="sold-' + esc(c.name) + '" ' + (isSold?'checked':'') + ' onchange="updateColorBadge(\\'' + esc(c.name) + '\\')"><span class="toggle-slider"></span></label>' +
        '</div>' +
        '<div class="inv-toggle-row"><span>非表示</span>' +
          '<label class="toggle"><input type="checkbox" id="hidden-' + esc(c.name) + '" ' + (isHidden?'checked':'') + ' onchange="updateColorBadge(\\'' + esc(c.name) + '\\')"><span class="toggle-slider"></span></label>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function updateColorBadge(name) {
  const isSold   = document.getElementById('sold-'  +name)?.checked;
  const isHidden = document.getElementById('hidden-'+name)?.checked;
  const badgeEl  = document.getElementById('cinv-badge-'+name);
  if (!badgeEl) return;
  badgeEl.innerHTML = isHidden
    ? '<span class="status-hidden">非表示</span>'
    : isSold
      ? '<span class="status-sold">在庫切れ</span>'
      : '<span class="status-ok">在庫あり</span>';
}

async function saveInventory() {
  const btn = document.getElementById('saveInvBtn');
  btn.disabled = true; btn.textContent = '保存中...';
  const colors = {};
  COLORS_DEF.forEach(function (c) {
    colors[c.name] = {
      soldOut: !!(document.getElementById('sold-'  +c.name)?.checked),
      hidden:  !!(document.getElementById('hidden-'+c.name)?.checked),
    };
  });
  try {
    const r = await fetch(BASE + '/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW },
      body: JSON.stringify({
        maintenance:    document.getElementById('maintToggle').checked,
        maintenanceMsg: document.getElementById('maintMsg').value.trim(),
        colors,
      }),
    });
    const d = await r.json();
    if (d.ok) toast('保存しました ✓');
    else      toast('エラー: ' + (d.error||'不明'));
  } catch(e) { toast('通信エラー'); }
  btn.disabled = false; btn.textContent = '在庫設定を保存する';
}

// ─── バックアップ ───
function doExport() {
  fetch(BASE + '/api/export', { headers: { Authorization: 'Bearer ' + PW } })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (data) {
      const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
      const a = document.createElement('a');
      const d = new Date();
      const stamp = d.getFullYear()+('0'+(d.getMonth()+1)).slice(-2)+('0'+d.getDate()).slice(-2)+'_'+('0'+d.getHours()).slice(-2)+('0'+d.getMinutes()).slice(-2);
      a.href = URL.createObjectURL(blob); a.download = 'buki-booth-backup_'+stamp+'.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
      toast('エクスポートしました（'+( data.count||0)+'件）');
    }).catch(function () { toast('エクスポートに失敗しました'); });
}

function doImport(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch(e) { toast('JSONファイルとして読めませんでした'); return; }
    if (!confirm('このバックアップを復元しますか？\\n同じ注文番号のデータは上書きされます。')) return;
    fetch(BASE + '/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW },
      body: JSON.stringify(parsed),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { toast('復元しました（'+(d.imported||0)+'件）'); loadList(); }
      else      { toast('エラー: '+(d.error||'不明')); }
    }).catch(function () { toast('インポートに失敗しました'); });
  };
  reader.readAsText(file);
}

// ─── ユーティリティ ───
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
  });
}
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.getFullYear()+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+('0'+d.getDate()).slice(-2)+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
  } catch(e) { return iso; }
}
// ─── URL一覧モーダル（各注文のURL・QRをまとめて表示／ダウンロード）───
var URLLIST_ID = '';
var URLLIST_TXT = '';
function openUrlList(orderId) {
  var item = null;
  for (var i = 0; i < ALL_ITEMS.length; i++) { if (ALL_ITEMS[i].orderId === orderId) { item = ALL_ITEMS[i]; break; } }
  var enc = encodeURIComponent(orderId);
  var nfcUrl   = BASE + '/nfc/' + enc;        // NFCタグが指す（リダイレクト）URL
  var qrUrl    = BASE + '/qr/'  + enc;        // 商品本体QRが指すURL
  var portal   = BASE + '/portal?add=' + enc; // お客さん用の変更ページ
  var setupUrl = BASE + '/setup/' + enc;      // 自動登録QR（OPP袋）が指す先
  var strip = function (u) { return u.replace('https://', '').replace('http://', ''); };

  URLLIST_ID = orderId;
  document.getElementById('urlListTitle').textContent = '注文番号 ' + orderId + ' の URL一覧';

  function row(label, url, withNoScheme) {
    var h = '<div class="ul-row"><div class="ul-label">' + label + '</div>';
    h += '<div class="ul-url">' + url + '</div><div class="ul-actions">';
    h += '<button class="copy-btn" onclick="copyText(\\'' + url + '\\')">コピー</button>';
    if (withNoScheme) h += '<button class="copy-btn" onclick="copyText(\\'' + strip(url) + '\\')">https://なしでコピー</button>';
    h += '</div></div>';
    return h;
  }
  // 設定済みの飛び先URL。リンクをクリックするとその先（お客さんが設定したURL）が開く。
  // 顧客入力なので esc() でエスケープし、onclickには生URLを入れない（リンク自体で開く）。
  function destRow(label, url) {
    var h = '<div class="ul-row"><div class="ul-label">' + label + '</div>';
    if (url) {
      h += '<div class="ul-url"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + ' ↗</a></div>';
    } else {
      h += '<div class="ul-url" style="color:var(--muted);">未設定</div>';
    }
    h += '</div>';
    return h;
  }
  var nfcDest = item ? (item.nfcUrl || '') : '';
  var qrDest  = item ? (item.qrUrl  || '') : '';
  var rows = '';
  rows += row('📡 NFC タグURL（印刷・貼付用）', nfcUrl, true);
  rows += destRow('　↳ NFCの飛び先（タップで開くお客さんの設定URL）', nfcDest);
  rows += row('📷 QR タグURL（印刷・貼付用）', qrUrl, true);
  rows += destRow('　↳ QRの飛び先（読み取りで開くお客さんの設定URL）', qrDest);
  rows += row('🔗 変更ページURL（お客さん用）', portal, false);
  document.getElementById('urlListRows').innerHTML = rows;

  // QR生成（自動登録=OPP袋 / 注文=商品本体）
  var qb1 = document.getElementById('ulSetupQr');   qb1.innerHTML = '';
  var qb2 = document.getElementById('ulProductQr'); qb2.innerHTML = '';
  if (window.QRCode) {
    new QRCode(qb1, { text: setupUrl, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
    new QRCode(qb2, { text: qrUrl,    width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
  }

  // テキスト一覧の組み立て
  var lines = [];
  lines.push('注文番号: ' + orderId);
  lines.push('');
  lines.push('[NFC タグURL] ' + nfcUrl);
  lines.push('[QR タグURL] ' + qrUrl);
  lines.push('[変更ページURL] ' + portal);
  lines.push('[自動登録QR(OPP袋)の中身] ' + setupUrl);
  if (item) {
    lines.push('');
    lines.push('現在のリダイレクト先:');
    lines.push('  NFC → ' + (item.nfcUrl || '未設定'));
    lines.push('  QR  → ' + (item.qrUrl || '未設定'));
  }
  URLLIST_TXT = lines.join('\\n');

  document.getElementById('urlListModal').classList.add('open');
}
function closeUrlList() { document.getElementById('urlListModal').classList.remove('open'); }
function dlUlQr(boxId, kind) {
  var box = document.getElementById(boxId);
  var im = box.querySelector('img') || box.querySelector('canvas'); if (!im) return;
  var src = (im.tagName === 'IMG') ? im.src : im.toDataURL('image/png');
  saveImage(src, kind + '_qr_' + URLLIST_ID + '.png', 'QRコード');
}
function dlUrlListTxt() {
  var blob = new Blob([URLLIST_TXT], { type: 'text/plain;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url; a.download = 'urls_' + URLLIST_ID + '.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// ─── サポート（管理者：一覧＋チャット返信）───
var SUP_ITEMS = [], SUP_CUR = null, SUP_RESOLVED = false, supPoll = null, supLastCount = -1;
function showSupport(push) {
  hideAll();
  document.getElementById('supportView').style.display = 'block';
  document.getElementById('homeNavBtn').style.display  = 'inline-block';
  loadSupport();
  nav('support', push);
}
function loadSupport() {
  var box = document.getElementById('supListBox');
  box.innerHTML = '<div class="empty">読み込み中...</div>';
  fetch(BASE + '/api/support-list', { headers: { Authorization: 'Bearer ' + PW } })
    .then(function (r) { return r.json(); })
    .then(function (d) { SUP_ITEMS = (d && d.items) ? d.items : []; renderSupport(); })
    .catch(function () { box.innerHTML = '<div class="empty">読み込みに失敗しました</div>'; });
}
function renderSupport() {
  var box = document.getElementById('supListBox');
  if (!SUP_ITEMS.length) { box.innerHTML = '<div class="empty">サポートはまだありません</div>'; return; }
  var html = '';
  for (var i = 0; i < SUP_ITEMS.length; i++) {
    var t = SUP_ITEMS[i]; var resolved = (t.status === 'resolved');
    html += '<div class="sup-row" onclick="openSupport(\\'' + esc(t.number) + '\\')">';
    html += '<div class="sup-row-top"><span class="sup-row-subj">' + esc(t.subject) + '</span>';
    html += '<span class="badge ' + (resolved ? 'resolved' : 'open') + '">' + (resolved ? '解決済み' : '対応中') + '</span></div>';
    html += '<div class="sup-row-sub">番号 ' + esc(t.number) + ' ・ ' + fmtDate(t.updatedAt || t.createdAt) + (t.contact ? (' ・ 連絡先：' + esc(t.contact)) : '') + '</div>';
    html += '</div>';
  }
  box.innerHTML = html;
}
function findSup(number) { for (var i = 0; i < SUP_ITEMS.length; i++) { if (SUP_ITEMS[i].number === number) return SUP_ITEMS[i]; } return null; }
function openSupport(number) {
  SUP_CUR = number; supLastCount = -1;
  var t = findSup(number) || {};
  document.getElementById('supTitle').textContent   = t.subject || '';
  document.getElementById('supNum').textContent     = 'サポート番号：' + number;
  document.getElementById('supContact').textContent = t.contact ? ('連絡先：' + t.contact) : '連絡先：（未記入）';
  document.getElementById('supDetail').textContent  = t.detail || '';
  document.getElementById('supChat').innerHTML = '';
  document.getElementById('supReply').value = '';
  document.getElementById('supportModal').classList.add('open');
  loadSupChat();
  if (supPoll) clearInterval(supPoll);
  supPoll = setInterval(loadSupChat, 4000);
}
function closeSupport() {
  document.getElementById('supportModal').classList.remove('open');
  if (supPoll) { clearInterval(supPoll); supPoll = null; }
  SUP_CUR = null; loadSupport();
}
function loadSupChat() {
  if (!SUP_CUR) return;
  fetch(BASE + '/api/support-get?number=' + encodeURIComponent(SUP_CUR))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.exists) return;
      var t = d.ticket; SUP_RESOLVED = (t.status === 'resolved');
      document.getElementById('supStatusBtn').textContent = SUP_RESOLVED ? '対応中に戻す' : '解決済みにする';
      renderSupChat(t.messages || []);
    }).catch(function () {});
}
function renderSupChat(msgs) {
  if (msgs.length === supLastCount) return; supLastCount = msgs.length;
  var box = document.getElementById('supChat'), html = '';
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i]; var who = (m.from === 'admin') ? 'admin' : 'user';
    html += '<div class="sup-bw ' + who + '"><div class="sup-bub ' + who + '">' + esc(m.text) + '</div><div class="sup-bt">' + (who === 'admin' ? 'あなた ' : 'お客さん ') + fmtDate(m.ts) + '</div></div>';
  }
  if (!msgs.length) html = '<div class="empty" style="padding:20px 0;">まだメッセージはありません</div>';
  box.innerHTML = html; box.scrollTop = box.scrollHeight;
}
function sendSupReply() {
  var ta = document.getElementById('supReply'); var text = (ta.value || '').trim(); if (!text || !SUP_CUR) return;
  fetch(BASE + '/api/support-reply', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW }, body: JSON.stringify({ number: SUP_CUR, text: text }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.ok) { ta.value = ''; supLastCount = -1; loadSupChat(); } else { toast((d && d.error) || '送信に失敗しました'); } })
    .catch(function () { toast('通信エラー'); });
}
function toggleSupStatus() {
  if (!SUP_CUR) return;
  var next = SUP_RESOLVED ? 'open' : 'resolved';
  fetch(BASE + '/api/support-update', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW }, body: JSON.stringify({ number: SUP_CUR, status: next }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.ok) { SUP_RESOLVED = (next === 'resolved'); document.getElementById('supStatusBtn').textContent = SUP_RESOLVED ? '対応中に戻す' : '解決済みにする'; toast(SUP_RESOLVED ? '解決済みにしました' : '対応中に戻しました'); } })
    .catch(function () { toast('通信エラー'); });
}

function copyText(t) { navigator.clipboard.writeText(t).then(function () { toast('コピーしました'); }); }
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 2500);
}
document.getElementById('editModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeEdit(); });
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════
// マイページ HTML（お客さん用）
// ═══════════════════════════════════════════════
function portalHTML() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>マイページ — リンク先の変更</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Mochiy+Pop+One&family=Noto+Sans+JP:wght@400;500;700&display=swap');
:root{--ink:#2c2740;--paper:#fffdf7;--cream:#fff4ea;--accent:#ff7a59;--accent-press:#e85f3f;--muted:#8a8398;--border:#f0e3d6;--radius:18px;--blue:#1a6fa8;--pop:'Mochiy Pop One',sans-serif;--surface:#fff;--sel:#fff8f5;--card-sh:0 5px 0 rgba(124,107,219,.08);--btn-pop:0 3px 0 rgba(0,0,0,.05);--cta-sh:0 4px 0 var(--accent-press);--cta-shA:0 1px 0 var(--accent-press);--topbar:linear-gradient(90deg,#ff7a59,#ff9d6b);}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans JP',sans-serif;background:var(--paper);color:var(--ink);min-height:100vh;padding-bottom:60px;}
.topbar{background:var(--topbar);padding:14px 20px;}
.logo{font-family:var(--pop);font-weight:400;font-size:18px;color:#fff;letter-spacing:.04em;text-shadow:0 1px 0 rgba(0,0,0,.12);}
.logo span{font-family:'Noto Sans JP',sans-serif;font-weight:400;font-size:12px;color:rgba(255,255,255,.6);margin-left:8px;}
.wrap{max-width:640px;margin:0 auto;padding:24px 16px;}
.page-hello{font-family:var(--pop);font-size:22px;font-weight:400;margin-bottom:4px;}
.page-sub{font-size:13px;color:var(--muted);line-height:1.7;margin-bottom:26px;}
.section-title{font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;}
.add-card{background:var(--surface);border-radius:var(--radius);border:1.5px solid var(--border);padding:18px;margin-bottom:28px;box-shadow:var(--card-sh);}
.add-row{display:flex;gap:8px;}
.add-row input{flex:1;min-width:0;padding:11px 13px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;font-family:'Noto Sans JP',sans-serif;outline:none;}
.add-row input:focus{border-color:var(--accent);}
.add-btn{padding:11px 20px;background:var(--accent);border:none;border-radius:12px;color:#fff;font-family:var(--pop);font-size:14px;font-weight:400;cursor:pointer;white-space:nowrap;box-shadow:var(--cta-sh);transition:transform .1s,box-shadow .1s,filter .15s;}
.add-btn:hover{filter:brightness(1.04);}
.add-hint{font-size:11px;color:var(--muted);margin-top:10px;line-height:1.6;}
.kc-card{background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:14px;box-shadow:var(--card-sh);}
.kc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--cream);}
.kc-id{font-family:monospace;font-size:14px;font-weight:500;word-break:break-all;}
.kc-label{font-size:12px;color:var(--muted);margin-left:6px;}
.kc-remove{font-size:12px;color:var(--muted);background:var(--surface);border:1.5px solid var(--border);border-radius:7px;padding:5px 11px;cursor:pointer;white-space:nowrap;}
.kc-remove:hover{border-color:var(--accent);color:var(--accent);}
.kc-field{margin-bottom:14px;}
.kc-flabel{display:block;font-size:12px;font-weight:500;margin-bottom:6px;}
.kc-fsub{font-size:11px;color:var(--muted);font-weight:400;}
.kc-field input{width:100%;padding:11px 13px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;font-family:'Noto Sans JP',sans-serif;outline:none;}
.kc-field input:focus{border-color:var(--accent);}
.kc-save{width:100%;padding:12px;background:var(--accent);border:none;border-radius:12px;color:#fff;font-family:var(--pop);font-size:14px;font-weight:400;cursor:pointer;margin-top:4px;box-shadow:var(--cta-sh);transition:transform .1s,box-shadow .1s,filter .15s;}
.kc-save:hover{filter:brightness(1.04);}
.kc-loading{font-size:13px;color:var(--muted);padding:6px 0;}
.kc-error{font-size:13px;color:var(--accent);background:#fdece4;border:1px solid #f5c4ae;border-radius:9px;padding:12px;line-height:1.6;}
.empty{text-align:center;padding:38px 20px;color:var(--muted);font-size:13px;line-height:1.9;background:var(--surface);border:1.5px dashed var(--border);border-radius:var(--radius);}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(8px);background:var(--ink);color:#fff;padding:9px 18px;border-radius:30px;font-size:13px;opacity:0;pointer-events:none;transition:all .25s;white-space:nowrap;z-index:200;}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0);}

/* テーマ切替ボタン */
.topbar{display:flex;align-items:center;justify-content:space-between;}
.theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:1.5px solid rgba(255,255,255,.55);background:rgba(255,255,255,.2);color:#fff;cursor:pointer;padding:0;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:transform .12s,background .2s;flex-shrink:0;}
.theme-toggle:hover{transform:scale(1.08);}
.theme-toggle:active{transform:scale(.93);}
.theme-toggle svg{width:18px;height:18px;display:block;}
.theme-toggle .ic-sun{display:none;}
:root[data-theme="night"] .theme-toggle .ic-sun{display:block;}
:root[data-theme="night"] .theme-toggle .ic-moon{display:none;}
:root[data-theme="night"] .theme-toggle{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#ffce9e;}

/* ===== ナイトモード ===== */
:root[data-theme="night"]{
  --ink:#ece9f3;--paper:#13111a;--cream:rgba(255,255,255,.06);
  --accent:#ff8358;--accent-press:#c75a3a;--muted:#9b93ac;--border:rgba(255,255,255,.12);
  --surface:rgba(255,255,255,.05);--sel:rgba(255,131,88,.12);
  --card-sh:0 16px 40px -22px rgba(0,0,0,.7);--btn-pop:none;
  --cta-sh:0 0 26px -6px rgba(255,131,88,.55);--cta-shA:0 0 12px -4px rgba(255,131,88,.55);
  --topbar:rgba(20,18,27,.55);--accent2:#ffcf7a;--ok:#46c178;--err:#ff6b5e;
}
:root[data-theme="night"] body{
  background:
    radial-gradient(140% 100% at 85% -8%,rgba(232,64,156,.42),transparent 62%),
    radial-gradient(140% 100% at -12% 108%,rgba(124,86,240,.40),transparent 62%),
    linear-gradient(160deg,#1c1228,#110d19 58%,#160f20);
  background-attachment:fixed;color:var(--ink);
}
:root[data-theme="night"] .topbar{-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.08);}
:root[data-theme="night"] .add-card,:root[data-theme="night"] .kc-card{-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);}
:root[data-theme="night"] .add-row input,:root[data-theme="night"] .kc-field input{background:rgba(0,0,0,.25);border-color:rgba(255,255,255,.12);color:var(--ink);}
:root[data-theme="night"] .kc-remove{background:rgba(255,255,255,.06);color:var(--muted);}
:root[data-theme="night"] .kc-error{background:rgba(255,131,88,.12);border-color:rgba(255,131,88,.3);color:#ff9d75;}
:root[data-theme="night"] .toast{background:#2a2433;}
</style>
<script>
(function(){var K='bukiTheme',mq=window.matchMedia('(prefers-color-scheme: dark)');
function eff(){var s=null;try{s=localStorage.getItem(K)}catch(e){}return(s==='light'||s==='night')?s:(mq.matches?'night':'light');}
function set(t){document.documentElement.setAttribute('data-theme',t);}
set(eff());
function om(){var s=null;try{s=localStorage.getItem(K)}catch(e){}if(s!=='light'&&s!=='night')set(mq.matches?'night':'light');}
if(mq.addEventListener)mq.addEventListener('change',om);else if(mq.addListener)mq.addListener(om);
function w(){var b=document.getElementById('themeToggle');if(!b)return;b.addEventListener('click',function(){var c=document.documentElement.getAttribute('data-theme')||eff();var n=(c==='night')?'light':'night';try{localStorage.setItem(K,n)}catch(e){}set(n);});}
if(document.readyState!=='loading')w();else document.addEventListener('DOMContentLoaded',w);})();
</script>
</head>
<body>
<div class="topbar"><div class="logo">BUKI BOOTH<span>マイページ</span></div><div class="topbar-right"><button id="themeToggle" class="theme-toggle" type="button" aria-label="ライト/ダーク表示を切り替え"><svg class="ic-moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg><svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1 1M17.4 17.4l1 1M18.4 5.6l-1 1M6.6 17.4l-1 1"/></svg></button><button id="navToggle" class="nav-toggle" type="button" aria-label="メニューを開く"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button></div></div><style>.topbar-right{display:flex;align-items:center;gap:12px;}.nav-toggle{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:1.5px solid rgba(255,255,255,.55);background:rgba(255,255,255,.2);color:#fff;cursor:pointer;padding:0;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:transform .12s,background .2s;flex-shrink:0;}.nav-toggle:hover{transform:scale(1.08);}.nav-toggle:active{transform:scale(.93);}.nav-toggle svg{width:20px;height:20px;display:block;}:root[data-theme="night"] .nav-toggle{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#ffce9e;}.nav-overlay{position:fixed;inset:0;background:rgba(10,8,16,.45);opacity:0;pointer-events:none;transition:opacity .25s;z-index:1999;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}.nav-overlay.open{opacity:1;pointer-events:auto;}.nav-drawer{position:fixed;top:0;right:0;height:100%;width:min(84vw,330px);background:#fff;color:var(--ink);box-shadow:-12px 0 40px -12px rgba(0,0,0,.4);transform:translateX(102%);transition:transform .28s cubic-bezier(.4,0,.2,1);z-index:2000;display:flex;flex-direction:column;overflow-y:auto;}.nav-drawer.open{transform:translateX(0);}:root[data-theme="night"] .nav-drawer{background:#1b1726;box-shadow:-12px 0 50px -10px rgba(0,0,0,.7);}.nav-dhead{display:flex;align-items:center;justify-content:space-between;padding:18px 18px 14px;border-bottom:1px solid var(--border);}.nav-dtitle{font-family:var(--pop);font-size:16px;color:var(--ink);}.nav-close{width:34px;height:34px;border:none;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:50%;}.nav-close:hover{background:var(--cream);}.nav-close svg{width:18px;height:18px;}.nav-link{display:flex;align-items:center;gap:12px;padding:15px 20px;color:var(--ink);text-decoration:none;font-size:15px;font-weight:700;border-bottom:1px solid var(--border);transition:background .15s;}.nav-link:hover{background:var(--cream);}.nav-link:active{background:var(--sel);}.nav-link.cur{color:var(--accent);background:var(--sel);}.nav-ic{font-size:18px;width:24px;text-align:center;}</style><div class="nav-overlay" id="navOverlay"></div><nav class="nav-drawer" id="navDrawer" aria-hidden="true"><div class="nav-dhead"><span class="nav-dtitle">メニュー</span><button class="nav-close" id="navClose" type="button" aria-label="閉じる"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><a class="nav-link" href="https://kiki9110.github.io/nfc-order-site/home.html"><span class="nav-ic">🏠</span>ホーム</a><a class="nav-link" href="https://kiki9110.github.io/nfc-order-site/page1.html"><span class="nav-ic">📝</span>注文ページ</a><a class="nav-link cur" href="/portal"><span class="nav-ic">🔗</span>URL変更（マイページ）</a><a class="nav-link" href="https://kiki9110.github.io/nfc-order-site/page4.html"><span class="nav-ic">⚙️</span>オプション割り当て</a><a class="nav-link" href="https://kiki9110.github.io/nfc-order-site/message.html"><span class="nav-ic">✉️</span>お問い合わせ</a><a class="nav-link" href="/support"><span class="nav-ic">🎫</span>サポート</a></nav><script>(function(){var t=document.getElementById('navToggle'),d=document.getElementById('navDrawer'),o=document.getElementById('navOverlay'),c=document.getElementById('navClose');if(!t||!d)return;function op(){d.classList.add('open');if(o)o.classList.add('open');d.setAttribute('aria-hidden','false');}function cl(){d.classList.remove('open');if(o)o.classList.remove('open');d.setAttribute('aria-hidden','true');}t.addEventListener('click',op);if(c)c.addEventListener('click',cl);if(o)o.addEventListener('click',cl);document.addEventListener('keydown',function(e){if(e.key==='Escape')cl();});})();</script>
<div class="wrap">
  <div class="page-hello">マイページ</div>
  <div class="page-sub">購入時の注文番号を追加すると、NFCタグ・QRコードのリンク先をいつでも何度でも変更できます。</div>

  <div class="section-title">注文番号を追加</div>
  <div class="add-card">
    <div class="add-row">
      <input type="text" id="addInput" placeholder="注文番号（例：O-XXXXXXXX）" onkeydown="if(event.key==='Enter')addOrder()">
      <button class="add-btn" onclick="addOrder()">追加</button>
    </div>
    <div class="add-hint">追加した注文番号はこの端末に保存され、次回以降もそのまま表示されます。</div>
  </div>

  <div class="section-title">あなたのキーホルダー</div>
  <div id="listArea"></div>
</div>
<div class="toast" id="toast"></div>

<script>
const BASE   = location.origin;
const LS_KEY = 'buki_portal_orders';
const ORIG   = {};

// 起動時：URL の ?add= があれば自動追加
window.addEventListener('DOMContentLoaded', function () {
  const params = new URLSearchParams(location.search);
  const add    = (params.get('add') || '').trim();
  if (add) {
    addToList(add);
    history.replaceState(null, '', location.pathname);
  }
  renderAll();
});

// localStorage 操作
function getList() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch(e) { return []; }
}
function saveList(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
function addToList(orderId) {
  const arr = getList();
  if (arr.indexOf(orderId) < 0) { arr.unshift(orderId); saveList(arr); }
}

// 入力欄から追加
function addOrder() {
  const v = document.getElementById('addInput').value.trim();
  if (!v) { toast('注文番号を入力してください'); return; }
  addToList(v);
  document.getElementById('addInput').value = '';
  renderAll();
}

// リストから削除（データは消さず、この端末の一覧から外すだけ）
function removeOrder(orderId) {
  saveList(getList().filter(function (x) { return x !== orderId; }));
  renderAll();
}

// 全カードを描画
function renderAll() {
  const area = document.getElementById('listArea');
  const list = getList();
  if (!list.length) {
    area.innerHTML = '<div class="empty">まだ注文番号が追加されていません。<br>上の入力欄に注文番号を入れて「追加」してください。</div>';
    return;
  }
  let html = '';
  for (let i = 0; i < list.length; i++) {
    const oid = list[i];
    html += '<div class="kc-card" id="card-' + cssId(oid) + '">';
    html +=   '<div class="kc-head">';
    html +=     '<div><span class="kc-id">' + esc(oid) + '</span><span class="kc-label" id="lbl-' + cssId(oid) + '"></span></div>';
    html +=     '<button class="kc-remove" onclick="removeOrder(\\'' + esc(oid) + '\\')">リストから削除</button>';
    html +=   '</div>';
    html +=   '<div id="body-' + cssId(oid) + '"><div class="kc-loading">読み込み中...</div></div>';
    html += '</div>';
  }
  area.innerHTML = html;
  for (let i = 0; i < list.length; i++) { loadOrder(list[i]); }
}

// 1件分の現在URLを取得してカードに反映
function loadOrder(orderId) {
  fetch(BASE + '/api/customer-get?orderId=' + encodeURIComponent(orderId))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      const body = document.getElementById('body-' + cssId(orderId));
      const lbl  = document.getElementById('lbl-'  + cssId(orderId));
      if (!body) return;
      if (!d.exists) {
        body.innerHTML = '<div class="kc-error">この注文番号は見つかりませんでした。番号をご確認ください。</div>';
        return;
      }
      if (lbl && d.label) lbl.textContent = '（' + d.label + '）';
      ORIG[orderId] = { nfc: d.nfcUrl || '', qr: d.hasQr ? (d.qrUrl || '') : null };

      let h = '';
      // NFC
      h += '<div class="kc-field">';
      h +=   '<span class="kc-flabel">📡 NFCタグ <span class="kc-fsub">スマホでタッチした時に開くURL</span></span>';
      h +=   '<input type="url" id="nfc-' + cssId(orderId) + '" placeholder="https://..." value="' + esc(d.nfcUrl || '') + '">';
      h += '</div>';
      // QR（ある時だけ）
      if (d.hasQr) {
        h += '<div class="kc-field">';
        h +=   '<span class="kc-flabel">📷 QRコード <span class="kc-fsub">読み取った時に開くURL</span></span>';
        h +=   '<input type="url" id="qr-' + cssId(orderId) + '" placeholder="https://..." value="' + esc(d.qrUrl || '') + '">';
        h += '</div>';
      }
      h += '<button class="kc-save" onclick="saveOrder(\\'' + esc(orderId) + '\\')">変更を保存</button>';
      body.innerHTML = h;
    })
    .catch(function () {
      const body = document.getElementById('body-' + cssId(orderId));
      if (body) body.innerHTML = '<div class="kc-error">通信エラーが発生しました。時間をおいて再度お試しください。</div>';
    });
}

// 保存（変わった項目だけ送信）
function saveOrder(orderId) {
  const nfcEl = document.getElementById('nfc-' + cssId(orderId));
  const qrEl  = document.getElementById('qr-'  + cssId(orderId));
  const orig  = ORIG[orderId] || { nfc: '', qr: null };
  const payload = { orderId };
  let changedCount = 0;

  if (nfcEl) {
    const v = nfcEl.value.trim();
    if (v && !v.startsWith('http')) { toast('NFCのURLは http から始めてください'); return; }
    if (v !== orig.nfc) { payload.nfcUrl = v; changedCount++; }
  }
  if (qrEl) {
    const v = qrEl.value.trim();
    if (v && !v.startsWith('http')) { toast('QRのURLは http から始めてください'); return; }
    if (v !== (orig.qr || '')) { payload.qrUrl = v; changedCount++; }
  }
  if (changedCount === 0) { toast('変更がありません'); return; }

  fetch(BASE + '/api/customer-set-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.ok) {
      if (payload.nfcUrl !== undefined) orig.nfc = payload.nfcUrl;
      if (payload.qrUrl  !== undefined) orig.qr  = payload.qrUrl;
      ORIG[orderId] = orig;
      toast('保存しました ✓');
    } else {
      toast('エラー: ' + (d.error||'不明'));
    }
  }).catch(function () { toast('通信エラーが発生しました'); });
}

// ユーティリティ
function cssId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
  });
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 2500);
}
</script>
</body>
</html>`;
}


// ═══════════════════════════════════════════════
// ユーティリティ関数
// ═══════════════════════════════════════════════

// URL 変更履歴を更新（変更があった時だけ・最大3件保持）
// record … { url, history, updatedAt, ... }
// newUrl … これから設定する新しい URL
function pushHistory(record, newUrl) {
  const oldUrl = (record && record.url) || '';
  if (oldUrl && oldUrl !== newUrl) {
    record.history = record.history || [];
    record.history.unshift({
      url: oldUrl,
      at:  record.updatedAt || record.registeredAt || new Date().toISOString(),
    });
    record.history = record.history.slice(0, 3); // 最大3件
  }
  if (record && !record.history) record.history = [];
}

// KV の全キーを取得（1000件超でも cursor で全件取得）
async function listAllKeys(env) {
  let keys   = [];
  let cursor = undefined;
  do {
    const res = await env.NFC_URLS.list(cursor ? { cursor } : {});
    keys   = keys.concat(res.keys);
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return keys;
}

// JSON レスポンスを返すヘルパー
// ============================================================
// メッセージ（お問い合わせ）
// ============================================================
// 公開：お問い合わせフォーム（message.html）からの送信を KV に保存する。
async function handleMessageCreate(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'POST必須' }, 405, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'JSON不正' }, 400, cors); }
  const text = String(body.text || '').slice(0, 4000).trim();
  if (!text) return json({ error: '本文が空です' }, 400, cors);
  const ts = Date.now();
  const id = 'MSG:' + ts + '-' + Math.random().toString(36).slice(2, 8);
  const rec = {
    id, ts,
    order:   String(body.order   || '').slice(0, 64),
    contact: String(body.contact || '').slice(0, 200),
    text,
    emailed: false,   // Gmail通知済みか（Code.gs が送信後に true にする）
    read:    false,   // 管理画面で既読にしたか
  };
  await env.NFC_URLS.put(id, JSON.stringify(rec));
  return json({ ok: true }, 200, cors);
}

// 管理者：メッセージ一覧を返す。?pending=1 で未通知（emailed=false）だけ返す（Code.gs 用）。
async function handleMessageList(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);
  const url = new URL(request.url);
  const pendingOnly = url.searchParams.get('pending') === '1';
  const list = await env.NFC_URLS.list({ prefix: 'MSG:' });
  const items = [];
  for (const k of list.keys) {
    const v = await env.NFC_URLS.get(k.name);
    if (!v) continue;
    let r; try { r = JSON.parse(v); } catch (e) { continue; }
    if (pendingOnly && r.emailed) continue;
    items.push(r);
  }
  items.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return json({ items }, 200, cors);
}

// 管理者：既読/削除（単一） と Gmail通知済みフラグ（バッチ）の更新。
async function handleMessageUpdate(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'JSON不正' }, 400, cors); }

  // バッチ：Code.gs が通知送信後に emailed=true を立てる { ids:[...], emailed:true }
  if (Array.isArray(body.ids)) {
    for (const id of body.ids) {
      const v = await env.NFC_URLS.get(id); if (!v) continue;
      let r; try { r = JSON.parse(v); } catch (e) { continue; }
      if (body.emailed === true) r.emailed = true;
      if (body.read === true) r.read = true;
      await env.NFC_URLS.put(id, JSON.stringify(r));
    }
    return json({ ok: true }, 200, cors);
  }

  // 単一：管理画面の既読切替・削除 { id, read?, delete? }
  const id = body.id;
  if (!id) return json({ error: 'id必須' }, 400, cors);
  if (body.delete === true) { await env.NFC_URLS.delete(id); return json({ ok: true }, 200, cors); }
  const v = await env.NFC_URLS.get(id);
  if (!v) return json({ error: '見つかりません' }, 404, cors);
  let r; try { r = JSON.parse(v); } catch (e) { return json({ error: 'parse' }, 500, cors); }
  if (typeof body.read === 'boolean') r.read = body.read;
  if (body.emailed === true) r.emailed = true;
  await env.NFC_URLS.put(id, JSON.stringify(r));
  return json({ ok: true }, 200, cors);
}

// ============================================================
// サポート（チケット＋チャット）
// ============================================================
// KV: 'SUP:<6桁番号>' →
//   { number, subject, detail, contact, status:'open'|'resolved',
//     createdAt, updatedAt, emailed, autoResolved,
//     messages:[{from:'user'|'admin', text, ts}], lastAdminReplyAt }

// 重複しない6桁のサポート番号を作る
async function genSupportNumber(env) {
  for (let i = 0; i < 25; i++) {
    const n = String(Math.floor(100000 + Math.random() * 900000)); // 100000〜999999
    const exists = await env.NFC_URLS.get('SUP:' + n);
    if (!exists) return n;
  }
  return String(Date.now()).slice(-6); // 保険
}

// 管理者の返信から1週間、お客さんの反応が無ければ自動で解決済みにする。
// （最後のメッセージが管理者＝お客さん放置、のときのみ）。変更したら true を返す（put は呼び出し側）。
function autoResolveIfStale(r) {
  if (!r || r.status !== 'open') return false;
  const msgs = r.messages || [];
  if (!msgs.length) return false;
  const last = msgs[msgs.length - 1];
  if (!last || last.from !== 'admin') return false;
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - (last.ts || 0) >= WEEK) { r.status = 'resolved'; r.autoResolved = true; return true; }
  return false;
}

// お客さん（番号を知る人）に返す内容。連絡先は含めない（総当たり対策）。
function publicTicket(r) {
  return {
    number: r.number, subject: r.subject, detail: r.detail,
    status: r.status, createdAt: r.createdAt, messages: r.messages || [],
  };
}

// 公開：サポート作成 { subject, detail, contact? } → { number }
async function handleSupportCreate(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'POST必須' }, 405, cors);
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'JSON不正' }, 400, cors); }
  const subject = String(body.subject || '').slice(0, 100).trim();
  const detail  = String(body.detail  || '').slice(0, 4000).trim();
  const contact = String(body.contact || '').slice(0, 200).trim();
  if (!subject) return json({ error: '要件を入力してください' }, 400, cors);
  if (!detail)  return json({ error: '要件の詳細を入力してください' }, 400, cors);
  const number = await genSupportNumber(env);
  const now = new Date().toISOString();
  const rec = {
    number, subject, detail, contact,
    status: 'open', createdAt: now, updatedAt: now,
    emailed: false, autoResolved: false, lastAdminReplyAt: null, messages: [],
  };
  await env.NFC_URLS.put('SUP:' + number, JSON.stringify(rec));
  return json({ ok: true, number }, 200, cors);
}

// 公開：番号で取得（チャット表示）。読み込み時に自動解決も判定する。
async function handleSupportGet(request, env, cors) {
  const url = new URL(request.url);
  const number = (url.searchParams.get('number') || '').trim();
  if (!number) return json({ error: 'number必須' }, 400, cors);
  const raw = await env.NFC_URLS.get('SUP:' + number);
  if (!raw) return json({ exists: false }, 200, cors);
  let r; try { r = JSON.parse(raw); } catch (e) { return json({ exists: false }, 200, cors); }
  if (autoResolveIfStale(r)) { r.updatedAt = new Date().toISOString(); await env.NFC_URLS.put('SUP:' + number, JSON.stringify(r)); }
  return json({ exists: true, ticket: publicTicket(r) }, 200, cors);
}

// 公開：本人がメッセージを追加 { number, text }。解決済みは送れない。
async function handleSupportMessage(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'POST必須' }, 405, cors);
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'JSON不正' }, 400, cors); }
  const number = String(body.number || '').trim();
  const text   = String(body.text || '').slice(0, 4000).trim();
  if (!number || !text) return json({ error: '入力が不正です' }, 400, cors);
  const raw = await env.NFC_URLS.get('SUP:' + number);
  if (!raw) return json({ error: '見つかりません' }, 404, cors);
  let r; try { r = JSON.parse(raw); } catch (e) { return json({ error: 'parse' }, 500, cors); }
  if (r.status === 'resolved') return json({ error: 'このサポートは解決済みのため送信できません' }, 403, cors);
  r.messages = r.messages || [];
  r.messages.push({ from: 'user', text, ts: Date.now() });
  r.updatedAt = new Date().toISOString();
  await env.NFC_URLS.put('SUP:' + number, JSON.stringify(r));
  return json({ ok: true }, 200, cors);
}

// 管理者：一覧（?pending=1 で未通知だけ＝Code.gs用）。返す前に古いものは自動解決。
async function handleSupportList(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);
  const url = new URL(request.url);
  const pendingOnly = url.searchParams.get('pending') === '1';
  const list = await env.NFC_URLS.list({ prefix: 'SUP:' });
  const items = [];
  for (const k of list.keys) {
    const v = await env.NFC_URLS.get(k.name); if (!v) continue;
    let r; try { r = JSON.parse(v); } catch (e) { continue; }
    if (autoResolveIfStale(r)) { r.updatedAt = new Date().toISOString(); await env.NFC_URLS.put(k.name, JSON.stringify(r)); }
    if (pendingOnly && r.emailed) continue;
    items.push(r);
  }
  items.sort(function (a, b) { return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime(); });
  return json({ items }, 200, cors);
}

// 管理者：返信 { number, text }（返信すると lastAdminReplyAt 更新・解決済みなら再オープン）
async function handleSupportReply(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'JSON不正' }, 400, cors); }
  const number = String(body.number || '').trim();
  const text   = String(body.text || '').slice(0, 4000).trim();
  if (!number || !text) return json({ error: '入力が不正です' }, 400, cors);
  const raw = await env.NFC_URLS.get('SUP:' + number);
  if (!raw) return json({ error: '見つかりません' }, 404, cors);
  let r; try { r = JSON.parse(raw); } catch (e) { return json({ error: 'parse' }, 500, cors); }
  const ts = Date.now();
  r.messages = r.messages || [];
  r.messages.push({ from: 'admin', text, ts });
  r.lastAdminReplyAt = new Date(ts).toISOString();
  if (r.status === 'resolved') { r.status = 'open'; r.autoResolved = false; }
  r.updatedAt = new Date().toISOString();
  await env.NFC_URLS.put('SUP:' + number, JSON.stringify(r));
  return json({ ok: true }, 200, cors);
}

// 管理者：状態更新／削除／通知済みフラグ（バッチ）／自動解決スイープ
async function handleSupportUpdate(request, env, cors) {
  const auth = request.headers.get('Authorization');
  if (auth !== adminBearer(env)) return json({ error: '認証エラー' }, 401, cors);
  let body; try { body = await request.json(); } catch (e) { return json({ error: 'JSON不正' }, 400, cors); }

  // 自動解決スイープ（Code.gsが定期実行）：放置チケットをまとめて解決済みにする
  if (body.sweep === true) {
    const list = await env.NFC_URLS.list({ prefix: 'SUP:' });
    let n = 0;
    for (const k of list.keys) {
      const v = await env.NFC_URLS.get(k.name); if (!v) continue;
      let r; try { r = JSON.parse(v); } catch (e) { continue; }
      if (autoResolveIfStale(r)) { r.updatedAt = new Date().toISOString(); await env.NFC_URLS.put(k.name, JSON.stringify(r)); n++; }
    }
    return json({ ok: true, resolved: n }, 200, cors);
  }

  // 通知済みフラグのバッチ（Code.gsが送信後に立てる）{ numbers:[...], emailed:true }
  if (Array.isArray(body.numbers)) {
    for (const num of body.numbers) {
      const v = await env.NFC_URLS.get('SUP:' + num); if (!v) continue;
      let r; try { r = JSON.parse(v); } catch (e) { continue; }
      if (body.emailed === true) r.emailed = true;
      await env.NFC_URLS.put('SUP:' + num, JSON.stringify(r));
    }
    return json({ ok: true }, 200, cors);
  }

  // 単一：状態変更 { number, status } / 削除 { number, delete:true }
  const number = String(body.number || '').trim();
  if (!number) return json({ error: 'number必須' }, 400, cors);
  if (body.delete === true) { await env.NFC_URLS.delete('SUP:' + number); return json({ ok: true }, 200, cors); }
  const raw = await env.NFC_URLS.get('SUP:' + number);
  if (!raw) return json({ error: '見つかりません' }, 404, cors);
  let r; try { r = JSON.parse(raw); } catch (e) { return json({ error: 'parse' }, 500, cors); }
  if (body.status === 'open' || body.status === 'resolved') { r.status = body.status; if (body.status === 'open') r.autoResolved = false; }
  r.updatedAt = new Date().toISOString();
  await env.NFC_URLS.put('SUP:' + number, JSON.stringify(r));
  return json({ ok: true }, 200, cors);
}


// ============================================================
// サポート：お客さん向けページ（Worker配信）
// ============================================================

// 一覧ページ（この端末で作成した分。localStorage に番号を保存）
function supportListHTML(origin) {
  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>サポート — BUKI BOOTH</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans JP',system-ui,sans-serif;background:#f6f7f9;color:#1a1d23;min-height:100vh;}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;background:#1a1d23;color:#fff;}
.logo{font-weight:700;font-size:16px;}
.newbtn{background:#3257d6;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-block;}
.newbtn:hover{background:#2543b0;}
.wrap{max-width:680px;margin:0 auto;padding:22px 16px;}
.page-title{font-size:18px;font-weight:700;margin-bottom:4px;}
.page-sub{font-size:12px;color:#6b7280;margin-bottom:18px;line-height:1.7;}
.sup-card{display:block;text-decoration:none;color:inherit;background:#fff;border:1.5px solid #e4e7ec;border-radius:10px;padding:14px 16px;margin-bottom:10px;transition:border-color .15s;}
.sup-card:hover{border-color:#1a1d23;}
.sup-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;}
.sup-subj{font-size:15px;font-weight:700;word-break:break-all;}
.sup-num{font-family:monospace;font-size:12px;color:#6b7280;}
.badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;}
.badge.open{background:#eef2fe;color:#3257d6;}
.badge.resolved{background:#e7f6ec;color:#15803d;}
.empty{text-align:center;color:#9ca3af;font-size:13px;padding:40px 16px;line-height:1.9;}
@media(max-width:520px){.topbar{flex-direction:column;align-items:stretch;}.newbtn{text-align:center;}}
</style></head>
<body>
<div class="topbar"><div class="logo">BUKI BOOTH サポート</div><a class="newbtn" href="/support/new">＋ 新規サポート作成</a></div>
<div class="wrap">
  <div class="page-title">あなたのサポート</div>
  <div class="page-sub">この端末から作成したサポートの一覧です。別の端末では表示されません。サポート番号があればチャットを開けます。</div>
  <div id="listArea"><div class="empty">読み込み中...</div></div>
</div>
<script>
var BASE = location.origin, LS = 'buki_support_numbers';
function getNums(){ try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch(e){ return []; } }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
function render(){
  var nums = getNums(), area = document.getElementById('listArea');
  if (!nums.length){ area.innerHTML = '<div class="empty">まだサポートはありません。<br>右上（スマホは上）の「＋ 新規サポート作成」から作成できます。</div>'; return; }
  Promise.all(nums.map(function(n){
    return fetch(BASE + '/api/support-get?number=' + encodeURIComponent(n)).then(function(r){return r.json();}).then(function(d){ return (d && d.exists) ? d.ticket : null; }).catch(function(){ return null; });
  })).then(function(tickets){
    var html = '';
    for (var i=0;i<tickets.length;i++){
      var t = tickets[i]; if (!t) continue;
      var resolved = t.status === 'resolved';
      html += '<a class="sup-card" href="/support/' + encodeURIComponent(t.number) + '">';
      html += '<div class="sup-top"><span class="sup-subj">' + esc(t.subject) + '</span>';
      html += '<span class="badge ' + (resolved?'resolved':'open') + '">' + (resolved?'解決済み':'対応中') + '</span></div>';
      html += '<div class="sup-num">サポート番号：' + esc(t.number) + '</div></a>';
    }
    area.innerHTML = html || '<div class="empty">表示できるサポートがありません。</div>';
  });
}
render();
</script>
</body></html>`;
}

// 新規作成ページ
function supportNewHTML(origin) {
  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>サポート作成 — BUKI BOOTH</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans JP',system-ui,sans-serif;background:#f6f7f9;color:#1a1d23;min-height:100vh;}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;background:#1a1d23;color:#fff;}
.logo{font-weight:700;font-size:16px;} .back{color:rgba(255,255,255,.85);font-size:13px;text-decoration:none;}
.wrap{max-width:620px;margin:0 auto;padding:22px 16px;}
.page-title{font-size:18px;font-weight:700;margin-bottom:4px;}
.page-sub{font-size:12px;color:#6b7280;margin-bottom:20px;line-height:1.7;}
.field{margin-bottom:16px;}
.field label{display:block;font-size:13px;font-weight:700;margin-bottom:6px;}
.req{color:#dc2626;font-size:11px;margin-left:6px;} .opt{color:#9ca3af;font-size:11px;margin-left:6px;}
input,textarea{width:100%;padding:11px 13px;border:1.5px solid #e4e7ec;border-radius:9px;font-size:14px;font-family:inherit;outline:none;background:#fff;}
input:focus,textarea:focus{border-color:#3257d6;}
textarea{min-height:150px;resize:vertical;}
.hint{font-size:11px;color:#9ca3af;margin-top:5px;line-height:1.6;}
.submit{width:100%;padding:14px;background:#3257d6;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;}
.submit:hover{background:#2543b0;} .submit:disabled{opacity:.6;cursor:default;}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1a1d23;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s;}
</style></head>
<body>
<div class="topbar"><div class="logo">サポート作成</div><a class="back" href="/support">← 一覧</a></div>
<div class="wrap">
  <div class="page-title">新しいサポートを作成</div>
  <div class="page-sub">内容を入力して送信してください。送信するとサポート番号が発行され、チャットでやり取りできます。</div>
  <div class="field"><label>要件<span class="req">必須</span></label>
    <input type="text" id="subject" placeholder="例：NFCタグが反応しません" maxlength="100"></div>
  <div class="field"><label>要件の詳細<span class="req">必須</span></label>
    <textarea id="detail" placeholder="状況をできるだけ詳しく教えてください。" maxlength="4000"></textarea></div>
  <div class="field"><label>連絡先（メールアドレスなど）<span class="opt">任意</span></label>
    <input type="text" id="contact" placeholder="無くてもOK" maxlength="200">
    <div class="hint">未入力でも構いません。このサポートページ上でやり取りします。</div></div>
  <button class="submit" id="sb" onclick="submitSupport()">送信する</button>
</div>
<div class="toast" id="toast"></div>
<script>
var BASE = location.origin, LS = 'buki_support_numbers';
function toast(m){ var t=document.getElementById('toast'); t.textContent=m; t.style.opacity='1'; setTimeout(function(){t.style.opacity='0';},2400); }
function addNum(n){ var a; try{a=JSON.parse(localStorage.getItem(LS)||'[]');}catch(e){a=[];} if(a.indexOf(n)<0){a.unshift(n);localStorage.setItem(LS,JSON.stringify(a));} }
function submitSupport(){
  var subject=document.getElementById('subject').value.trim();
  var detail=document.getElementById('detail').value.trim();
  var contact=document.getElementById('contact').value.trim();
  if(!subject){ toast('要件を入力してください'); return; }
  if(!detail){ toast('要件の詳細を入力してください'); return; }
  var b=document.getElementById('sb'); b.disabled=true; b.textContent='送信中...';
  fetch(BASE+'/api/support-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:subject,detail:detail,contact:contact})})
   .then(function(r){return r.json();})
   .then(function(d){ if(d&&d.ok&&d.number){ addNum(d.number); location.href='/support/'+encodeURIComponent(d.number); } else { toast('送信に失敗：'+((d&&d.error)||'不明')); b.disabled=false; b.textContent='送信する'; } })
   .catch(function(){ toast('通信エラー'); b.disabled=false; b.textContent='送信する'; });
}
</script>
</body></html>`;
}

// チャットページ（番号別）
function supportChatHTML(origin) {
  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>サポートチャット — BUKI BOOTH</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;}
body{font-family:'Noto Sans JP',system-ui,sans-serif;background:#f6f7f9;color:#1a1d23;display:flex;flex-direction:column;height:100vh;}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;background:#1a1d23;color:#fff;flex-shrink:0;}
.logo{font-weight:700;font-size:15px;} .back{color:rgba(255,255,255,.85);font-size:13px;text-decoration:none;}
.head{background:#fff;border-bottom:1px solid #e4e7ec;padding:14px 16px;flex-shrink:0;}
.head .row1{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;}
.head .subj{font-size:16px;font-weight:700;word-break:break-all;}
.head .num{font-family:monospace;font-size:12px;color:#6b7280;}
.head .detail{font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;word-break:break-all;margin-top:8px;background:#f6f7f9;border-radius:8px;padding:9px 11px;}
.badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;}
.badge.open{background:#eef2fe;color:#3257d6;} .badge.resolved{background:#e7f6ec;color:#15803d;}
.chat{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:4px;}
.bw{display:flex;flex-direction:column;max-width:82%;margin-bottom:6px;}
.bw.user{align-self:flex-end;align-items:flex-end;} .bw.admin{align-self:flex-start;align-items:flex-start;}
.bubble{padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.6;word-break:break-all;white-space:pre-wrap;}
.bubble.user{background:#3257d6;color:#fff;border-bottom-right-radius:4px;}
.bubble.admin{background:#fff;border:1px solid #e4e7ec;border-bottom-left-radius:4px;}
.bt{font-size:10px;color:#9ca3af;margin:2px 4px 0;}
.inbar{flex-shrink:0;display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e4e7ec;}
.inbar textarea{flex:1;border:1.5px solid #e4e7ec;border-radius:20px;padding:10px 15px;font-size:14px;font-family:inherit;resize:none;outline:none;max-height:120px;}
.inbar textarea:focus{border-color:#3257d6;}
.sendbtn{flex-shrink:0;width:44px;height:44px;border-radius:50%;background:#3257d6;color:#fff;border:none;font-size:17px;cursor:pointer;}
.sendbtn:disabled{opacity:.5;}
.resolved-note{text-align:center;font-size:12px;color:#6b7280;padding:14px;background:#eef0f3;flex-shrink:0;}
</style></head>
<body>
<div class="topbar"><div class="logo">サポート</div><a class="back" href="/support">← 一覧</a></div>
<div class="head"><div class="row1"><span class="subj" id="subj">読み込み中...</span><span class="badge open" id="badge">—</span></div><div class="num" id="num"></div><div class="detail" id="detail" style="display:none;"></div></div>
<div class="chat" id="chat"></div>
<div id="footer"></div>
<script>
var BASE = location.origin;
var NUMBER = decodeURIComponent((location.pathname.split('/support/')[1] || '').replace(/\\/.*$/, ''));
var lastCount = -1, resolved = false;
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
function fmt(ts){ if(!ts) return ''; var d=new Date(ts); function p(n){return ('0'+n).slice(-2);} return (d.getMonth()+1)+'/'+d.getDate()+' '+p(d.getHours())+':'+p(d.getMinutes()); }
function load(){
  fetch(BASE+'/api/support-get?number='+encodeURIComponent(NUMBER)).then(function(r){return r.json();}).then(function(d){
    if(!d||!d.exists){ document.getElementById('subj').textContent='サポートが見つかりません'; document.getElementById('num').textContent='番号：'+NUMBER; return; }
    var t=d.ticket; resolved = (t.status==='resolved');
    document.getElementById('subj').textContent=t.subject;
    document.getElementById('num').textContent='サポート番号：'+t.number;
    var dt=document.getElementById('detail'); dt.textContent=t.detail; dt.style.display='block';
    var bd=document.getElementById('badge'); bd.textContent=resolved?'解決済み':'対応中'; bd.className='badge '+(resolved?'resolved':'open');
    renderMsgs(t.messages||[]); renderFooter();
  }).catch(function(){});
}
function renderMsgs(msgs){
  if(msgs.length===lastCount) return; lastCount=msgs.length;
  var chat=document.getElementById('chat'), html='';
  for(var i=0;i<msgs.length;i++){ var m=msgs[i]; var who=(m.from==='admin')?'admin':'user';
    html+='<div class="bw '+who+'"><div class="bubble '+who+'">'+esc(m.text)+'</div><div class="bt">'+(who==='admin'?'サポート ':'あなた ')+fmt(m.ts)+'</div></div>';
  }
  if(!msgs.length) html='<div style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px;">メッセージを送ってサポートを開始してください。</div>';
  chat.innerHTML=html; chat.scrollTop=chat.scrollHeight;
}
function renderFooter(){
  var f=document.getElementById('footer');
  if(resolved){ f.innerHTML='<div class="resolved-note">このサポートは解決済みです。追加のご相談は新しいサポートを作成してください。</div>'; return; }
  if(f.querySelector('textarea')) return;
  f.innerHTML='<div class="inbar"><textarea id="msg" rows="1" placeholder="メッセージを入力"></textarea><button class="sendbtn" id="send" onclick="send()">&#10148;</button></div>';
}
function send(){
  var ta=document.getElementById('msg'); var text=(ta.value||'').trim(); if(!text) return;
  var b=document.getElementById('send'); b.disabled=true;
  fetch(BASE+'/api/support-message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:NUMBER,text:text})})
   .then(function(r){return r.json();}).then(function(d){ b.disabled=false; if(d&&d.ok){ ta.value=''; lastCount=-1; load(); } else { alert((d&&d.error)||'送信に失敗しました'); } })
   .catch(function(){ b.disabled=false; alert('通信エラー'); });
}
load();
setInterval(load, 4000);
</script>
</body></html>`;
}

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
