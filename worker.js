// BOOTH のサイト（buki-booth.com）の Worker：転送役（2026-11-15）
//
// サイトを buki-seisakujo.com にまとめたので、この Worker は転送だけを行う。
//   /nfc/<番号>・/qr/<番号> → https://buki-seisakujo.com の同じ道へ
//   ほかの全部             → https://buki-seisakujo.com/ へ
// どれも 302（一時的な転送）。KV は読まない・書かない（中身は消していない）。
// 前の中身は、このファイルの git の履歴に残っている。

const NEW_SITE = 'https://buki-seisakujo.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/nfc/') || path.startsWith('/qr/')) {
      return Response.redirect(NEW_SITE + path, 302);
    }
    return Response.redirect(NEW_SITE + '/', 302);
  },
};
