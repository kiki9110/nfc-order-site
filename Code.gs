/**
 * ============================================================
 * buki-booth 注文番号 自動登録スクリプト（Google Apps Script）
 * ============================================================
 *
 * 【役割】
 *   Gmail に届く BOOTH の注文通知メールを読み取り、注文番号を抽出して
 *   Cloudflare Worker（/api/register）に自動登録する。
 *   登録された注文番号だけが、page1 のログインや page2 の注文保存で通る。
 *
 * 【動作の流れ】
 *   1. 条件に合うメールを Gmail から検索
 *   2. 本文から注文番号を抽出
 *   3. すでに登録済みならスキップ、未登録なら Worker に登録
 *   4. 処理済みのメールにはラベルを付けて、次回以降は対象から外す
 *
 * 【使い方】
 *   ・初回：setupTrigger() を一度だけ実行 → 数分おきの自動実行が登録される
 *   ・手動：runOnce() を実行 → その場で1回だけチェック
 *   ・テスト：testExtract() を実行 → メールを登録せず抽出結果だけ確認
 *
 * ★ 下の CONFIG を自分の環境に合わせて必ず変更してください ★
 */


// ============================================================
// 設定（ここを自分の環境に合わせて変更）
// ============================================================
const CONFIG = {
  // Cloudflare Worker のベースURL（末尾スラッシュなし）
  WORKER_ORIGIN: 'https://buki-booth.com',

  // worker.js の ADMIN_PASSWORD と完全に同じ文字列にする
  // （管理者として登録するため、この認証が必要）
  ADMIN_PASSWORD: 'your-secret-password-here',

  // お問い合わせメッセージの通知先メールアドレス。
  // 空文字 '' のままなら、このスクリプトを実行している自分の Gmail に送られます。
  // 別のアドレスに送りたいときだけ設定してください。
  NOTIFY_EMAIL: '',

  // 対象メールを絞り込む Gmail 検索条件
  //   from:                   送信元（BOOTH の通知）
  //   subject:(... OR ...):    入金が確定した注文の通知だけに絞る。
  //     ・「ご注文が確定しました」… 現在のBOOTH形式。入金確定時に届く（コンビニ払い等は
  //        後払いなので、この確定メールが入金後に届く。未入金の「商品が注文されました」は対象外）。
  //     ・「商品が購入されました」… 旧形式／テストメール用に一応残す。
  //   newer_than:             古すぎるメールを無視
  // ※ 件名の精密判定はコード側の isTargetMail() で行う。ここは粗い絞り込み。
  GMAIL_QUERY: 'from:booth.pm newer_than:30d (subject:ご注文が確定しました OR subject:商品が購入されました)',

  // ──────────────────────────────────────────────
  // 商品名の設定（★テスト中は demo、本番は実際の商品名★）
  // ──────────────────────────────────────────────
  // メール本文の「注文内容」欄に出る商品名で判定する。
  // 各項目は「候補リスト」になっていて、リストのどれか1つでも本文に含まれれば一致とみなす。
  // → テスト用の demo 名と本番名の両方を入れておけば、どちらのメールでも動く。
  //
  // ★ テストが終わったら、各リストから 'demoX' の行を消すだけで本番専用になる。★

  // ① 本体商品：これが注文内容に含まれているときだけ登録する。
  //    （本体が無い注文＝オプション単体などは登録しない）
  PRODUCT_BODY: [
    'キーホルダー本体',  // 本番の本体商品名
    '(demo1)',           // ← テスト用。不要になったら消す
  ],

  // ② オプション商品：本文に含まれていれば、そのオプションを「購入済み」として保存する。
  //    page2 ではここで購入済みになったオプションだけ選択可能になる（ステップ2で実装）。
  //    key  … page2 側で使う識別子（変更しないこと）
  //    name … 管理画面などで表示する名前
  //    mail … メール本文中の商品名の候補リスト（どれか1つ一致でOK）
  OPTIONS: [
    { key: 'nfc',    name: 'NFCタグ',     mail: ['（OP）NFCタグ',     '(demo2)'] },
    { key: 'double', name: '両面印刷',    mail: ['（OP）両面印刷']               },
  ],

  // ③ 追加注文（2枚目以降）：オプションのロックではなく「何枚追加されたか」を数える。
  //    本文の商品名の直後の金額行に「x ○点」があればその数、無ければ1枚とみなす。
  //    買われていなければ 0 枚。最大4枚まで購入される想定。
  ADDON_REORDER: [
    '（OP）2枚目以降',  // 本番名
    '(demo3)',          // ← テスト用。不要になったら消す
  ],

  // 処理済みメールに付けるラベル名（同じメールを二重処理しないため）
  PROCESSED_LABEL: 'buki-booth-登録済み',

  // 登録時に各注文へ付けるラベル（管理画面での目印。空でもよい）
  ORDER_LABEL: 'BOOTH自動登録',

  // 1回の実行で処理する最大スレッド数（多すぎる実行を防ぐ安全上限）
  MAX_THREADS: 20,
};


// ============================================================
// 注文番号の抽出（★メール形式に合わせて調整する中心部分★）
// ============================================================
/**
 * メール本文（と件名）から注文番号を取り出す。
 * BOOTH の通知メールの実際の書式が分かったら、ここの正規表現を調整する。
 *
 * 現状は「ありがちな書式」を上から順に試し、最初に当たったものを採用する。
 * 見つからなければ null を返す（その場合そのメールはスキップされる）。
 *
 * @param {string} subject 件名
 * @param {string} body    本文（プレーンテキスト）
 * @return {string|null}   注文番号、または見つからなければ null
 */
/**
 * その件名が「登録対象（入金確定の注文通知）」かどうかを判定する。
 *
 * BOOTH の現行形式では、入金が確定すると
 *   「（【BOOSTあり】）ご注文が確定しました（注文番号 XXXXXXXX） [BOOTH]」
 * が届く。コンビニ払い等の後払いでも、入金後にこの確定メールが届く。
 * 一方「商品が注文されました（お支払い未完了）」は入金前なので対象外にする。
 * 旧形式／テスト用の「商品が購入されました」も一応対象に含める。
 *
 * @param {string} subject 件名
 * @return {boolean} 登録対象なら true
 */
function isTargetMail(subject) {
  return /ご注文が確定しました|商品が購入されました/.test(subject || '');
}

function extractOrderId(subject, body) {
  const text = (subject || '') + '\n' + (body || '');

  // 試す抽出パターン（上から順に。当たり次第そのキャプチャを返す）
  //
  // 出品者向けメール（商品が購入されました）では、番号がこの形で入る：
  //   件名: 商品が購入されました（注文番号 83044766） [BOOTH]
  //   本文: | 注文番号
  //         + ----------
  //         83044766            ← ラベルの下に改行して数字だけ
  // 件名の「（注文番号 ...）」が最も確実なのでそれを最優先で拾う。
  const patterns = [
    // ① 件名の「（注文番号 83044766）」（出品者メールに必ず入る・最も確実）
    /注文番号\s*(\d{6,12})\s*）/,
    // ② 本文の「| 注文番号」ラベルの後（区切り線や改行を挟んで数字）
    /注文番号\s*[\s\S]{0,40}?(\d{6,12})/,
    // ③ 注文詳細・ダウンロードURL内の番号（買ったときのメール形式の予備）
    /booth\.pm\/orders\/(\d{6,12})/i,
    // ④ 「[注文番号] 82579079」（角カッコ表記）
    /\[\s*注文番号\s*\]\s*(\d{6,12})/,
    // ⑤ 英語表記「Order Number: 12345678」
    /order\s*(?:number|no\.?|id)\s*[:：]?\s*(\d{6,12})/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }

  return null; // どのパターンにも当たらなかった
}


// ============================================================
// 商品名・オプションの抽出
// ============================================================
/**
 * 指定した商品名（候補リスト）のいずれかが、メール本文の注文内容に含まれているか判定する。
 * @param {string} body  本文
 * @param {string|string[]} mails  探す商品名（文字列 または 候補リスト）
 * @return {boolean}     どれか1つでも含まれていれば true
 */
function bodyHasProduct(body, mails) {
  if (!mails) return false;
  const list = Array.isArray(mails) ? mails : [mails];
  return list.some(function(m){ return m && body.indexOf(m) !== -1; });
}

/**
 * 指定した商品が「何個」購入されたかを数える。
 *
 * BOOTH の出品者メールでは、注文内容が「商品名 → 改行 → 金額行」で並ぶ。
 *   オーダーメイドキーホルダー (demo3)
 *   ¥ 100 x 3点 = ¥ 300        ← 2個以上だと金額行に「x ○点」が付く
 * 1個のときは「x ○点」が付かず金額だけ（¥ 100）。
 *
 * 商品名の「直後の最初の金額行」だけを見て個数を判定する。
 * （後続の別商品の行を誤って拾わないようにするのが重要）
 *
 * @param {string} body  本文
 * @param {string|string[]} mails  探す商品名（文字列 または 候補リスト）
 * @return {number}      個数。買われていなければ 0、表記が無ければ 1。
 */
function countProduct(body, mails) {
  if (!mails) return 0;
  const list = Array.isArray(mails) ? mails : [mails];

  // 候補リストのうち、最初に本文で見つかった商品名で個数を数える
  for (const mail of list) {
    if (!mail) continue;
    const idx = body.indexOf(mail);
    if (idx === -1) continue; // この候補は本文に無い → 次の候補へ

    // 商品名より後ろのテキストを行に分割し、最初の非空行（＝金額行）を取る
    const after = body.slice(idx + mail.length);
    const lines = after.split('\n');
    let moneyLine = '';
    for (let i = 1; i < lines.length; i++) { // i=0 は商品名行の残りなので 1 から
      if (lines[i].trim()) { moneyLine = lines[i]; break; }
    }

    // 金額行に「x ○点」があればその数。無ければ 1 個。
    const m = moneyLine.match(/x\s*(\d+)\s*点/);
    return m ? parseInt(m[1], 10) : 1;
  }

  return 0; // どの候補も本文に無い＝買われていない
}


// ============================================================
// メイン処理：メールを読んで未登録の注文番号を登録する
// ============================================================
/**
 * Gmail を検索し、未処理メールから注文番号を抽出して Worker に登録する。
 * 時間トリガーからも、手動の runOnce() からも呼ばれる共通処理。
 */
function processOrders() {
  const processedLabel = getOrCreateLabel(CONFIG.PROCESSED_LABEL);

  // 【重要】ラベルはスレッド単位でしか付けられない。すでにラベルが付いた
  // スレッドに後から新しい注文メールが「同じスレッド」として届くと、
  // -label 除外でスレッドごと読み飛ばされ、その新規メールが永久に登録されない。
  // → 検索ではラベル除外せず、処理済みは「メッセージID単位」で管理する。
  const threads = GmailApp.search(CONFIG.GMAIL_QUERY, 0, CONFIG.MAX_THREADS);

  if (threads.length === 0) {
    Logger.log('対象のメールはありませんでした。');
    return;
  }

  // これまでに登録できたメッセージID一覧（メッセージ単位の二重登録防止）
  const processedIds = loadProcessedIds();

  let registered = 0; // 新規に登録した数
  let skipped    = 0; // すでに登録済みでスキップした数
  let failed     = 0; // 抽出失敗・エラーの数

  for (const thread of threads) {
    const messages = thread.getMessages();
    let handledInThread = false; // このスレッドで1件でも注文番号を扱えたか

    for (const msg of messages) {
      // このメール（メッセージ単位）を過去に登録済みならスキップ
      const msgId = msg.getId();
      if (processedIds[msgId]) continue;

      const subject = msg.getSubject();
      const body    = msg.getPlainBody();

      // 入金が確定した注文の通知でなければ対象外（未入金メール等はここで除外）
      if (!isTargetMail(subject)) continue;

      const orderId = extractOrderId(subject, body);
      if (!orderId) {
        Logger.log('注文番号を抽出できませんでした（件名: ' + subject + '）');
        continue;
      }

      // 購入済みオプションを判定（本文に商品名があるものだけ true）
      const options = {};
      CONFIG.OPTIONS.forEach(function(opt){
        options[opt.key] = bodyHasProduct(body, opt.mail);
      });
      // 追加注文（2枚目以降）の枚数を数える（買われていなければ 0）
      const addonCount = countProduct(body, CONFIG.ADDON_REORDER);

      // 本体商品が含まれているか
      const hasBody = bodyHasProduct(body, CONFIG.PRODUCT_BODY);
      // オプション or 追加が1つでも含まれているか
      const hasAnyOption = Object.keys(options).some(function(k){ return options[k]; }) || addonCount > 0;

      // ── 振り分け ──
      // ① 本体あり → 通常のキーホルダー注文として登録（従来どおり）
      // ② 本体なし＋オプションあり → オプション単体注文として「オプション在庫」に登録
      // ③ どちらも無い → 対象外（スキップ）
      if (!hasBody && !hasAnyOption) {
        continue; // オプションも本体も無い無関係なメール
      }

      if (!hasBody && hasAnyOption) {
        // ===== オプション単体注文として登録 =====
        try {
          const already = isOptionOrderRegistered(orderId);
          registerOptionOrder(orderId, options, addonCount);
          Logger.log(
            (already ? 'オプション在庫を更新: ' : 'オプション在庫を登録: ') + orderId +
            ' / ' + JSON.stringify(options) + ' / 追加: ' + addonCount + '枚'
          );
          if (already) { skipped++; } else { registered++; }
          processedIds[msgId] = Date.now();  // このメールを処理済みに記録
          handledInThread = true;
        } catch (e) {
          Logger.log('オプション在庫の登録エラー（' + orderId + '）: ' + e);
          failed++;
        }
        continue; // この注文の処理は完了。本体登録には進まない
      }

      // ===== ここから下は「本体あり」注文の通常登録（従来どおり）=====
      try {
        // すでに登録済みかを確認（ログで「新規」か「更新」かを区別するため）
        const already = isAlreadyRegistered(orderId);

        // 登録（または更新）。worker.js 側で既存のURL・履歴は保持されるので、
        // 登録済みでも安全に上書きでき、オプション情報を最新のメール内容に更新できる。
        registerOrder(orderId, options, addonCount);

        Logger.log(
          (already ? '情報を更新しました: ' : '新規登録しました: ') + orderId +
          ' / オプション: ' + JSON.stringify(options) +
          ' / 2枚目以降: ' + addonCount + '枚'
        );
        if (already) { skipped++; } else { registered++; }
        processedIds[msgId] = Date.now();  // このメールを処理済みに記録
        handledInThread = true;
      } catch (e) {
        Logger.log('登録エラー（' + orderId + '）: ' + e);
        failed++;
      }
    }

    // 1件でも処理できたスレッドには目印としてラベルを付ける（人が見て分かるように）。
    // ※ 次回の読み飛ばしは processedIds（メッセージ単位）で行うため、この
    //   ラベルはあくまで管理用の目印で、除外条件には使わない。
    if (handledInThread) {
      thread.addLabel(processedLabel);
    }
  }

  // 処理済みメッセージID一覧を保存（次回以降の二重登録防止）
  saveProcessedIds(processedIds);

  Logger.log(
    '完了 — 新規登録: ' + registered +
    ' / 情報更新: ' + skipped +
    ' / 失敗: ' + failed
  );

  // 同じ 5 分トリガーで、お問い合わせメッセージのメール通知も処理する。
  // （万が一エラーが出ても、上の注文処理には影響させない）
  try {
    notifyNewMessages();
  } catch (e) {
    Logger.log('メッセージ通知エラー: ' + e);
  }

  // サポート：新規サポートのメール通知＋1週間放置の自動解決。
  try {
    notifyNewSupport();
  } catch (e) {
    Logger.log('サポート通知エラー: ' + e);
  }
}


// ============================================================
// お問い合わせメッセージの通知
// ============================================================
/**
 * Worker に届いた「未通知」のお問い合わせメッセージを取得し、
 * 自分宛て（または CONFIG.NOTIFY_EMAIL）にメールで知らせる。
 * 送信できたものは Worker 側で emailed=true（通知済み）にして、次回から再送しない。
 *
 * processOrders() の最後から呼ばれるので、5分おきのトリガーで自動実行される。
 */
function notifyNewMessages() {
  // 1) 未通知メッセージ一覧を取得（?pending=1 で emailed=false のものだけ返る）
  const url = CONFIG.WORKER_ORIGIN + '/api/messages?pending=1';
  const res = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + CONFIG.ADMIN_PASSWORD },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('メッセージ取得失敗: ' + res.getResponseCode() + ' ' + res.getContentText());
    return;
  }
  const data = JSON.parse(res.getContentText());
  const items = (data && data.items) ? data.items : [];
  if (items.length === 0) return; // 新着なし

  // 2) 送信先（空なら、このスクリプトの実行者＝自分の Gmail）
  const to = CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();

  // 3) 1通ずつメール送信し、成功したものの id を集める
  const sentIds = [];
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    const when = m.ts
      ? Utilities.formatDate(new Date(m.ts), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm')
      : '';
    const body = [
      'お問い合わせフォームに新しいメッセージが届きました。',
      '',
      '日時　　：' + when,
      '注文番号：' + (m.order   || '（未記入）'),
      '連絡先　：' + (m.contact || '（未記入）'),
      '',
      '----- 本文 -----',
      m.text || '',
      '----------------',
      '',
      '▼ 管理画面で確認',
      CONFIG.WORKER_ORIGIN + '/admin',
    ].join('\n');
    try {
      MailApp.sendEmail({
        to: to,
        subject: '【BUKI BOOTH】お問い合わせ' + (m.order ? '（注文 ' + m.order + '）' : ''),
        body: body,
      });
      sentIds.push(m.id);
    } catch (e) {
      Logger.log('メール送信失敗（' + m.id + '）: ' + e);
    }
  }

  // 4) 送信できたものを Worker 側で「通知済み」にする（バッチ）→ 次回から再送されない
  if (sentIds.length > 0) {
    const up = UrlFetchApp.fetch(CONFIG.WORKER_ORIGIN + '/api/message-update', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + CONFIG.ADMIN_PASSWORD },
      payload: JSON.stringify({ ids: sentIds, emailed: true }),
      muteHttpExceptions: true,
    });
    if (up.getResponseCode() !== 200) {
      Logger.log('通知済みフラグ更新失敗: ' + up.getResponseCode() + ' ' + up.getContentText());
    }
  }
  Logger.log('メッセージ通知 — 送信: ' + sentIds.length + ' 件');
}

/**
 * 手動テスト用：今すぐ未通知メッセージの通知だけを実行する。
 * （Apps Script エディタでこの関数を選んで「実行」）
 */
function notifyOnce() {
  notifyNewMessages();
}


// ============================================================
// サポートの通知＋自動解決
// ============================================================
/**
 * Worker に届いた「未通知」のサポートを取得してメールで知らせ、
 * 送信できたものは Worker 側で emailed=true（通知済み）にする。
 * あわせて「管理者の返信から1週間放置」のサポートを自動で解決済みにする。
 *
 * processOrders() の最後から呼ばれるので、5分おきのトリガーで自動実行される。
 */
function notifyNewSupport() {
  // 1) 未通知サポート一覧を取得（?pending=1 で emailed=false のものだけ返る）
  const url = CONFIG.WORKER_ORIGIN + '/api/support-list?pending=1';
  const res = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + CONFIG.ADMIN_PASSWORD },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 200) {
    const data  = JSON.parse(res.getContentText());
    const items = (data && data.items) ? data.items : [];
    if (items.length > 0) {
      const to = CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
      const sentNumbers = [];
      for (let i = 0; i < items.length; i++) {
        const s = items[i];
        const when = s.createdAt
          ? Utilities.formatDate(new Date(s.createdAt), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm')
          : '';
        const body = [
          'サポートページに新しいサポートが届きました。',
          '',
          '日時　　：' + when,
          'サポート番号：' + (s.number || ''),
          'お名前　：' + (s.name || '（未記入）'),
          '連絡先　：' + (s.contact || '（未記入）'),
          '要件　　：' + (s.subject || ''),
          '',
          '----- 要件の詳細 -----',
          s.detail || '',
          '----------------------',
          '',
          '▼ 管理画面のサポートで返信',
          CONFIG.WORKER_ORIGIN + '/admin#support',
        ].join('\n');
        try {
          MailApp.sendEmail({
            to: to,
            subject: '【BUKI BOOTH】サポート（番号 ' + (s.number || '') + '）' + (s.subject ? '：' + s.subject : ''),
            body: body,
          });
          sentNumbers.push(s.number);
        } catch (e) {
          Logger.log('サポートメール送信失敗（' + s.number + '）: ' + e);
        }
      }
      // 送信できたものを「通知済み」にする（次回から再送されない）
      if (sentNumbers.length > 0) {
        const up = UrlFetchApp.fetch(CONFIG.WORKER_ORIGIN + '/api/support-update', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'Authorization': 'Bearer ' + CONFIG.ADMIN_PASSWORD },
          payload: JSON.stringify({ numbers: sentNumbers, emailed: true }),
          muteHttpExceptions: true,
        });
        if (up.getResponseCode() !== 200) {
          Logger.log('サポート通知済みフラグ更新失敗: ' + up.getResponseCode() + ' ' + up.getContentText());
        }
      }
      Logger.log('サポート通知 — 送信: ' + sentNumbers.length + ' 件');
    }
  } else {
    Logger.log('サポート取得失敗: ' + res.getResponseCode() + ' ' + res.getContentText());
  }

  // 2) 放置サポートの自動解決スイープ（管理者返信から1週間お客さんの反応なし → 解決済み）
  const sweep = UrlFetchApp.fetch(CONFIG.WORKER_ORIGIN + '/api/support-update', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.ADMIN_PASSWORD },
    payload: JSON.stringify({ sweep: true }),
    muteHttpExceptions: true,
  });
  if (sweep.getResponseCode() === 200) {
    const sd = JSON.parse(sweep.getContentText());
    if (sd && sd.resolved) Logger.log('サポート自動解決: ' + sd.resolved + ' 件');
  }
}


// ============================================================
// Worker との通信
// ============================================================
/**
 * 注文番号がすでに KV に登録されているか確認する。
 * 認証不要の /api/customer-get を使う（exists フラグが返る）。
 *
 * @param {string} orderId
 * @return {boolean} 登録済みなら true
 */
function isAlreadyRegistered(orderId) {
  const url = CONFIG.WORKER_ORIGIN + '/api/customer-get?orderId=' + encodeURIComponent(orderId);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return false; // 確認できなければ未登録扱いで登録を試みる
  const data = JSON.parse(res.getContentText());
  return data && data.exists === true;
}

/**
 * 注文番号を Worker に登録する（管理者として /api/register を呼ぶ）。
 * NFC・QR の URL は空のまま登録し、後でお客さんが設定できるようにする。
 * 購入済みオプションと、2枚目以降の追加枚数も一緒に保存する。
 *
 * @param {string} orderId     注文番号
 * @param {Object} options     購入済みオプション { nfc:true/false, double:..., diecut:... }
 * @param {number} addonCount  2枚目以降の追加枚数（買われていなければ 0）
 */
function registerOrder(orderId, options, addonCount) {
  const url = CONFIG.WORKER_ORIGIN + '/api/register';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.ADMIN_PASSWORD },
    payload: JSON.stringify({
      orderId: orderId,
      nfcUrl: '',                    // 空＝お客さんが後で設定
      qrUrl:  '',                    // 空＝お客さんが後で設定
      label:  CONFIG.ORDER_LABEL,    // 管理画面での目印
      options: options || {},        // 購入済みオプション（page2 のロック判定に使う）
      addonCount: addonCount || 0,   // 2枚目以降の追加枚数（管理画面に表示）
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Worker応答コード ' + code + ' : ' + res.getContentText());
  }
}

/**
 * オプション単体注文が、すでにオプション在庫に登録されているか確認する。
 * @param {string} orderId
 * @return {boolean} 登録済みなら true
 */
function isOptionOrderRegistered(orderId) {
  const url = CONFIG.WORKER_ORIGIN + '/api/opt-get?orderId=' + encodeURIComponent(orderId);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return false;
  const data = JSON.parse(res.getContentText());
  return data && data.exists === true;
}

/**
 * オプション単体注文を「オプション在庫」として Worker に登録する。
 * （本体キーホルダー注文とは別枠。後で page4 でお客さんが本体に紐付ける）
 *
 * @param {string} orderId     オプション単体注文の注文番号
 * @param {Object} options     含まれるオプション { nfc:true/false, double:..., diecut:... }
 * @param {number} addonCount  2枚目以降の追加枚数
 */
function registerOptionOrder(orderId, options, addonCount) {
  const url = CONFIG.WORKER_ORIGIN + '/api/opt-register';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.ADMIN_PASSWORD },
    payload: JSON.stringify({
      orderId:    orderId,
      options:    options || {},
      addonCount: addonCount || 0,
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Worker応答コード ' + code + ' : ' + res.getContentText());
  }
}// ============================================================
// ラベル操作
// ============================================================
/**
 * 指定名の Gmail ラベルを取得する。なければ作成する。
 * @param {string} name
 * @return {GmailLabel}
 */
function getOrCreateLabel(name) {
  let label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  return label;
}


// ============================================================
// 処理済みメッセージIDの管理（スレッド単位ラベルの取りこぼし対策）
// ============================================================
// Gmail のラベルはスレッド単位でしか付けられないため、既処理スレッドに
// 後から届いた新規メールを取りこぼす。そこで「登録できたメッセージのID」を
// スクリプトプロパティに記録し、メッセージ単位で二重登録を防ぐ。

const PROCESSED_PROP_KEY = 'processedMsgIds_v1';

/** 処理済みメッセージID一覧を読み込む（{ メッセージID: 記録時刻ミリ秒 }）。 */
function loadProcessedIds() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROCESSED_PROP_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

/**
 * 処理済みメッセージID一覧を保存する。
 * 検索は newer_than:30d で絞っているので、それより十分に古い記録（40日超）は
 * 二度と再検索に出てこない → 間引いてプロパティの肥大化を防ぐ。
 * @param {Object} map { メッセージID: 記録時刻ミリ秒 }
 */
function saveProcessedIds(map) {
  const cutoff = Date.now() - 40 * 24 * 60 * 60 * 1000;
  const pruned = {};
  Object.keys(map).forEach(function(id){
    if (map[id] && map[id] > cutoff) pruned[id] = map[id];
  });
  PropertiesService.getScriptProperties().setProperty(PROCESSED_PROP_KEY, JSON.stringify(pruned));
}


// ============================================================
// 実行用エントリーポイント
// ============================================================

/**
 * 【手動実行用】その場で1回だけメールをチェックして登録する。
 * メニューから選んで実行できる。
 */
function runOnce() {
  processOrders();
}

/**
 * 【やり直し・テスト用】処理済みラベルを無視して、対象メールを強制的に再処理する。
 *
 * 通常 runOnce() は「処理済みラベル」が付いたメールを読み飛ばすが、
 * この関数はラベルを無視するので、過去に登録した注文も最新のメール内容で
 * 登録し直せる。（例: オプション情報の保存を後から追加したので入れ直したいとき）
 *
 * ※ worker.js 側で既存のURL・履歴は保持されるので、再処理しても
 *   お客さんが設定済みのURLは消えない。
 */
function reprocessAll() {
  // GMAIL_QUERY から「処理済みラベル除外」を付けずに検索 ＝ ラベル付きも対象になる
  const threads = GmailApp.search(CONFIG.GMAIL_QUERY, 0, CONFIG.MAX_THREADS);
  if (threads.length === 0) {
    Logger.log('対象のメールが見つかりませんでした。');
    return;
  }

  let count = 0;
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const subject = msg.getSubject();
      const body    = msg.getPlainBody();

      if (!isTargetMail(subject)) continue;

      const orderId = extractOrderId(subject, body);
      if (!orderId) continue;

      const options = {};
      CONFIG.OPTIONS.forEach(function(opt){ options[opt.key] = bodyHasProduct(body, opt.mail); });
      const addonCount = countProduct(body, CONFIG.ADDON_REORDER);

      const hasBody      = bodyHasProduct(body, CONFIG.PRODUCT_BODY);
      const hasAnyOption = Object.keys(options).some(function(k){ return options[k]; }) || addonCount > 0;

      if (!hasBody && !hasAnyOption) continue;

      try {
        if (!hasBody && hasAnyOption) {
          // オプション単体注文
          registerOptionOrder(orderId, options, addonCount);
          Logger.log('再登録(オプション在庫): ' + orderId + ' / ' + JSON.stringify(options) + ' / 追加: ' + addonCount + '枚');
        } else {
          // 本体注文
          registerOrder(orderId, options, addonCount);
          Logger.log('再登録(本体): ' + orderId + ' / ' + JSON.stringify(options) + ' / 2枚目以降: ' + addonCount + '枚');
        }
        count++;
      } catch (e) {
        Logger.log('再登録エラー（' + orderId + '）: ' + e);
      }
    }
  }
  Logger.log('強制再処理 完了 — ' + count + ' 件');
}

/**
 * 【初回セットアップ用】数分おきの自動実行トリガーを登録する。
 * 一度だけ実行すればよい。重複登録を防ぐため、既存トリガーは削除してから作る。
 */
function setupTrigger() {
  // 既存の processOrders トリガーをすべて削除（重複防止）
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'processOrders') {
      ScriptApp.deleteTrigger(t);
    }
  }

  // 5分おきに processOrders を実行するトリガーを新規作成
  ScriptApp.newTrigger('processOrders')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('自動実行トリガーを登録しました（5分おき）。');
}

/**
 * 【トリガー解除用】自動実行を止めたいときに実行する。
 */
function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'processOrders') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  }
  Logger.log('トリガーを ' + count + ' 件解除しました。');
}


// ============================================================
// テスト用（登録せず抽出結果だけ確認）
// ============================================================
/**
 * 【動作確認用】対象メールから注文番号がちゃんと抽出できるかだけを確認する。
 * Worker への登録はせず、ログに結果を出すだけ。
 * メール形式に合わせて extractOrderId を調整するときに使う。
 */
function testExtract() {
  const threads = GmailApp.search(CONFIG.GMAIL_QUERY, 0, 5);
  if (threads.length === 0) {
    Logger.log('テスト対象のメールが見つかりませんでした。GMAIL_QUERY を確認してください。');
    return;
  }

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const subject = msg.getSubject();
      const body    = msg.getPlainBody();

      const orderId  = extractOrderId(subject, body);
      const hasBody  = bodyHasProduct(body, CONFIG.PRODUCT_BODY);

      // 各オプションの購入状況
      const optLines = CONFIG.OPTIONS.map(function(opt){
        return '  ' + opt.name + ': ' + (bodyHasProduct(body, opt.mail) ? '購入あり' : 'なし');
      }).join('\n');

      // 2枚目以降の枚数
      const addon = countProduct(body, CONFIG.ADDON_REORDER);

      Logger.log(
        '件名: ' + subject + '\n' +
        '注文番号: ' + (orderId ? orderId : '（抽出できず）') + '\n' +
        '本体商品: ' + (hasBody ? 'あり（登録対象）' : 'なし（登録しない）') + '\n' +
        'オプション:\n' + optLines + '\n' +
        '2枚目以降: ' + addon + '枚\n' +
        '--------------------'
      );
    }
  }
}
