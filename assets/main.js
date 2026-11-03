'use strict';

// ?capture=1 なら、スクリーンショット用に動きを止める。
const capture = new URLSearchParams(location.search).get('capture') === '1';
if (capture) {
  document.body.classList.add('capture');
  document.documentElement.style.scrollBehavior = 'auto';
}

// 共通ナビゲーション。リンクを選んだ後やEscapeキーでも閉じる。
const menu = document.querySelector('.menu');
const nav = document.querySelector('#nav');
function closeMenu() {
  nav.classList.remove('open');
  menu.setAttribute('aria-expanded', 'false');
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('open', open);
});
nav.querySelectorAll('a, button').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav.classList.contains('open')) {
    closeMenu();
    menu.focus();
  }
});

// ネイティブdialogでフォーカスの移動・復帰とキーボード操作に対応する。
const dialog = document.querySelector('#notice');
const title = document.querySelector('#dialog-title');
const content = document.querySelector('#dialog-content');
function appendParagraph(text) {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  content.append(paragraph);
}
function showNotice(heading, text) {
  title.textContent = heading;
  content.replaceChildren();
  appendParagraph(text);
  dialog.showModal();
}
document.querySelectorAll('.close, .close-dialog').forEach(button => {
  button.addEventListener('click', () => dialog.close());
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

// デモには実予約・応援受付・架空SNSへの外部リンクを設けない。
const notices = {
  reservation: ['ご予約のデモです', 'こちらは架空の喫茶店の制作サンプルです。実際の予約はできません。予約受付や予約サービスとの連携は、この静的サイト制作サービスの対象外です。'],
  support: ['応援・協賛のデモです', '人物・活動は架空の設定です。実際の協賛受付や決済は行っていません。活動紹介から相談へつなげる導線のサンプルとしてご覧ください。'],
  social: ['SNSリンクのデモです', 'この選手のSNSは設定されていません。架空のアカウントや外部ページへは移動しません。'],
};
document.querySelectorAll('[data-notice]').forEach(button => {
  button.addEventListener('click', () => showNotice(...notices[button.dataset.notice]));
});

// 相談先はconfig.jsの1か所だけで変更。HTTPSのココナラURLだけを使用する。
function getCoconalaUrl() {
  try {
    const url = new URL(window.SITE_CONFIG?.coconalaUrl?.trim());
    const allowedHost = url.hostname === 'coconala.com' || url.hostname === 'www.coconala.com';
    return url.protocol === 'https:' && allowedHost && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}
document.querySelectorAll('.consult').forEach(button => {
  button.addEventListener('click', () => {
    const url = getCoconalaUrl();
    if (url) {
      location.assign(url.href);
      return;
    }
    title.textContent = 'ココナラでのご相談について';
    content.replaceChildren();
    appendParagraph('ココナラの出品URLはまだ設定されていません。この画面から情報を送信・保存することはありません。');
    appendParagraph('静的サイトの新規制作はページ数に関係なく一律50,000円。月1件の受付で、1か月かけて制作します。修正・機能追加は10,000円から承ります。');
    appendParagraph('事業や活動の内容、サイトの目的、載せたい内容、参考にしたい雰囲気、ご希望の着手時期を分かる範囲でまとめておくと、相談を始めやすくなります。Web制作を勉強している方も歓迎します。コードへのコメントをご希望の場合もお知らせください。');
    appendParagraph('基本的にチャットで、実際に動く画面を確認いただきながら進めます。サーバー側の処理が必要な機能は対象外です。');
    dialog.showModal();
  });
});

// HTMLのdata-categoryとボタンのdata-filterを対応させて一覧を絞り込む。
document.querySelectorAll('[data-group]').forEach(group => {
  const list = document.getElementById(group.dataset.group);
  group.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      group.querySelectorAll('button').forEach(item => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      list.querySelectorAll('[data-category]').forEach(item => {
        item.hidden = button.dataset.filter !== 'all' && item.dataset.category !== button.dataset.filter;
      });
    });
  });
});

// 入力確認専用のフォーム。送信・保存はせず、入力は必ずテキストとして表示する。
const form = document.querySelector('#demo-form');
if (form) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    title.textContent = '入力内容の確認（デモ）';
    content.replaceChildren();
    appendParagraph('送信は行われません。入力内容はこの画面での確認だけに使用し、保存しません。');
    for (const [name, label] of [['type', 'ご相談の種類'], ['name', '表示用のお名前'], ['message', 'ご相談内容']]) {
      const row = document.createElement('div');
      row.className = 'confirm-row';
      const heading = document.createElement('b');
      heading.textContent = label;
      row.append(heading, document.createTextNode(form.elements[name].value));
      content.append(row);
    }
    const done = document.createElement('button');
    done.className = 'button green';
    done.textContent = 'デモを完了して入力を消去';
    done.addEventListener('click', () => {
      form.reset();
      showNotice('デモの確認が完了しました', '入力内容を消去しました。外部送信・保存はしていません。実際の問い合わせ送信にはバックエンドや外部サービスが必要で、このサービスの対象外です。');
    });
    content.append(done);
    dialog.showModal();
  });
  window.addEventListener('pageshow', () => form.reset());
}
