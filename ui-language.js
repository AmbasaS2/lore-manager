// Automatic UI language selection, following SillyTavern (no new saved setting).
// Only call these helpers on extension-authored display strings, never lorebook content.
import { SETTINGS_UI } from './ui-language-settings.js';
import { LIBRARY_UI } from './ui-language-library.js';
import { EDITOR_UI } from './ui-language-editor.js';
const EXTRA_UI = Object.freeze({
  "삭제": [
    "Delete",
    "削除",
    "删除",
    "刪除",
    "Eliminar"
  ],
  "선택한 항목의 원문과 저장된 번역본을 함께 삭제합니다.": [
    "Deletes both original content and saved translations of selected entries.",
    "選択した項目の原本と保存済み翻訳を両方削除します。",
    "同时删除所选条目的原文与已保存译文。",
    "同時刪除所選條目的原文與已儲存譯文。",
    "Elimina el original y las traducciones guardadas de las entradas seleccionadas."
  ],
  "선택한 {0}개 항목을 삭제할까요?": [
    "Delete {0} selected entries?",
    "選択した{0}件を削除しますか？",
    "删除选中的 {0} 个条目？",
    "刪除選取的 {0} 個條目？",
    "¿Eliminar {0} entradas seleccionadas?"
  ],
  "현재 로어북 “{0}”을 “{1}” 백업 상태로 복원할까요?\n복원 직전 상태도 자동으로 안전 백업됩니다.": [
    "Restore current lorebook “{0}” from backup “{1}”?\nA safety backup of the current state is made first.",
    "現在のロアブック「{0}」を「{1}」のバックアップから復元しますか？\n復元前に安全バックアップを作成します。",
    "将当前世界书“{0}”恢复至备份“{1}”？\n恢复前会自动创建安全备份。",
    "將目前世界書「{0}」還原至備份「{1}」？\n還原前會自動建立安全備份。",
    "¿Restaurar el lorebook «{0}» desde la copia «{1}»?\nSe creará antes una copia de seguridad del estado actual."
  ],
  "“{0}”의 {1} 1개를 이 브라우저의 백업 저장소에서 삭제할까요? 실제 로어북 원본은 유지됩니다.": [
    "Delete one {1} backup of “{0}” from this browser? The original lorebook will remain.",
    "「{0}」の{1}バックアップ1件をこのブラウザーから削除しますか？原本は保持されます。",
    "从此浏览器删除“{0}”的一个{1}备份？原始世界书将保留。",
    "從此瀏覽器刪除「{0}」的一個{1}備份？原始世界書將保留。",
    "¿Eliminar una copia {1} de «{0}» de este navegador? Se conservará el original."
  ],
  "이 브라우저의 로어북 매니저 백업 {0}개를 모두 삭제할까요?\n실제 로어북·번역 기록·확장 설정은 유지됩니다.": [
    "Delete all {0} Lorebook Manager backups in this browser?\nOriginal lorebooks, translations and extension settings remain.",
    "このブラウザーのバックアップ{0}件をすべて削除しますか？\n原本・翻訳・拡張設定は保持されます。",
    "删除此浏览器中的全部 {0} 个备份？\n原始世界书、译文和扩展设置将保留。",
    "刪除此瀏覽器中的全部 {0} 個備份？\n原始世界書、譯文及擴充設定將保留。",
    "¿Eliminar las {0} copias de este navegador?\nSe conservarán los originales, traducciones y ajustes."
  ],
  "\n자동 백업이 켜져 있어 이후 새로운 백업은 다시 생성될 수 있습니다.": [
    "\nAutomatic backup is enabled and may create new backups later.",
    "\n自動バックアップが有効なため、新しいバックアップが作成される場合があります。",
    "\n自动备份已开启，之后可能创建新备份。",
    "\n自動備份已開啟，之後可能建立新備份。",
    "\nLa copia automática está activada y puede crear copias nuevas."
  ],
  "{0}개 선택": [
    "{0} selected",
    "{0}件選択",
    "已选 {0} 项",
    "已選 {0} 項",
    "{0} seleccionados"
  ],
  "선택한 {0}개 항목에 {1} 변경 적용": [
    "Applied {1} change to {0} selected entries"
  ],
  "{0}권 중 {1}권 표시": [
    "Showing {1} of {0} books",
    "{0}冊中{1}冊を表示",
    "显示 {0} 本中的 {1} 本",
    "顯示 {0} 本中的 {1} 本",
    "Se muestran {1} de {0} libros"
  ],
  "항목 {0}개": [
    "{0} entries",
    "{0}件",
    "{0} 个条目",
    "{0} 個條目",
    "{0} entradas"
  ],
  "{0}개 로어북 선택됨": [
    "{0} lorebooks selected",
    "{0}冊選択",
    "已选 {0} 本世界书",
    "已選 {0} 本世界書",
    "{0} lorebooks seleccionados"
  ],
  "선택한 백업을 불러오지 못했습니다.": [
    "Could not load selected backup."
  ],
  "복원할 현재 로어북을 먼저 선택해주세요.": [
    "Select the current lorebook to restore first."
  ],
  "같은 이름의 로어북이 이미 있습니다.": [
    "A lorebook with that name already exists."
  ],
  "삭제할 로어북을 불러오지 못했습니다.": [
    "Could not load lorebook for deletion."
  ]
});
const MESSAGES = Object.freeze({ ...SETTINGS_UI, ...LIBRARY_UI, ...EDITOR_UI, ...EXTRA_UI });
let localeProvider = () => 'ko'; // isolated library tests retain the original Korean UI
export function configureUiLocale(provider) { if (typeof provider === 'function') localeProvider = provider; }
export function resolveUiLocale(locale) {
    const value = String(locale || 'en').toLowerCase().replaceAll('_', '-');
    if (/^ko(?:-|$)/.test(value)) return 'ko';
    if (/^ja(?:-|$)/.test(value)) return 'ja';
    if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(value)) return 'zh-tw';
    if (/^zh(?:-|$)/.test(value)) return 'zh-cn';
    if (/^es(?:-|$)/.test(value)) return 'es';
    return 'en';
}
const columns = Object.freeze({ en: 0, ja: 1, 'zh-cn': 2, 'zh-tw': 3, es: 4 });
export function uiText(source, ...values) {
    let locale = 'en';
    try { locale = resolveUiLocale(localeProvider()); } catch { /* English fallback */ }
    const variants = Object.hasOwn(MESSAGES, source) ? MESSAGES[source] : null;
    const text = locale === 'ko' || !variants ? source : (variants[columns[locale]] ?? variants[0] ?? source);
    return String(text).replace(/\{(\d+)\}/g, (token, index) => values[Number(index)] === undefined ? token : String(values[Number(index)]));
}
export function uiHtml(source, ...values) {
    return uiText(source, ...values).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
