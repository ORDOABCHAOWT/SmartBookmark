/**
 * "选择"按钮 — 进入多选编辑模式。
 * 点击后给 .container 加 .edit-mode 触发 CSS 显示每行的 checkbox，
 * 然后调用 editManager.enterEditMode 让 BookmarkEditManager 接管。
 */
(function () {
  function setup() {
    const btn = document.getElementById('enter-select-mode');
    const container = document.querySelector('.container');
    if (!btn || !container) return;

    btn.addEventListener('click', () => {
      const manager =
        (typeof getBookmarkManager === 'function' && getBookmarkManager()) || null;

      // Find the first bookmark item as the "seed" item for enterEditMode
      // (BookmarkEditManager requires an initial item to bootstrap selection).
      const firstItem = document.querySelector('#bookmarks-list .bookmark-item');

      if (manager && manager.editManager) {
        if (manager.editManager.isInEditMode()) {
          // Already in edit mode — toggle off
          manager.editManager.exitEditMode();
        } else if (firstItem) {
          manager.editManager.enterEditMode(firstItem);
          // Don't pre-select the seed item: clear its selection
          const cb = firstItem.querySelector('.bookmark-checkbox input');
          if (cb) {
            cb.checked = false;
            firstItem.classList.remove('selected');
          }
          if (manager.editManager.selectedBookmarks) {
            manager.editManager.selectedBookmarks.clear();
          }
          if (typeof manager.editManager.updateSelectedCount === 'function') {
            manager.editManager.updateSelectedCount();
          }
          if (typeof manager.editManager.updateSelectAllCheckbox === 'function') {
            manager.editManager.updateSelectAllCheckbox();
          }
        } else {
          // No bookmarks yet — just toggle the visual edit-mode class
          container.classList.toggle('edit-mode');
        }
      } else {
        // Fallback: pure CSS toggle so checkboxes still appear
        container.classList.toggle('edit-mode');
      }

      // Reflect pressed state on the toolbar button
      btn.classList.toggle('active', container.classList.contains('edit-mode'));
    });

    // Keep button state in sync when edit mode is exited from elsewhere
    const observer = new MutationObserver(() => {
      btn.classList.toggle('active', container.classList.contains('edit-mode'));
    });
    observer.observe(container, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
