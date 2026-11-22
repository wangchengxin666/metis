/**
 * File manager — browser bundle.
 *
 * Registers one lazy factory with the module loader. Everything except the
 * `load` call lives INSIDE the factory: the loader executes this script during
 * boot but materializes the factory only on first use, and code outside the
 * factory would run without a `require` in scope. The browser copy has no
 * `./client.js` chunk, so the page modules are inlined into the factory body by
 * `scripts/bundle-client.mjs`; edit `src/client/*.js`, then re-run that script.
 */
window.__ModuleLoader__.load({
  id: '@metis/file-manager',
  factory(require) {
    const __mods = {}
    /**
     * Collect the inlined page modules.
     * @returns the page modules by id.
     */
    const modules = () => __mods

    // styles
    __mods.styles = (() => {
        /**
         * File manager — page styles.
         *
         * Injected as one `<style>` element owned by the page component, so the
         * stylesheet leaves with the panel. Only theme tokens are used, so light and
         * dark themes and a renamed token degrade rather than break.
         */

        /** Class names the page markup uses. */
        const css = {
          page: 'fmPage',
          header: 'fmHeader',
          headerText: 'fmHeaderText',
          title: 'fmTitle',
          subtitle: 'fmSubtitle',
          toolbar: 'fmToolbar',
          breadcrumbRow: 'fmBreadcrumbRow',
          addressForm: 'fmAddressForm',
          addressInput: 'fmAddressInput',
          button: 'fmButton',
          buttonPrimary: 'fmButtonPrimary',
          buttonDanger: 'fmButtonDanger',
          buttonIcon: 'fmButtonIcon',
          hiddenCheck: 'fmHiddenCheck',
          hiddenCheckDisabled: 'fmHiddenCheckDisabled',
          breadcrumb: 'fmBreadcrumb',
          crumb: 'fmCrumb',
          crumbCurrent: 'fmCrumbCurrent',
          crumbSep: 'fmCrumbSep',
          roots: 'fmRoots',
          rootChip: 'fmRootChip',
          filterRow: 'fmFilterRow',
          filterInput: 'fmFilterInput',
          notice: 'fmNotice',
          noticeError: 'fmNoticeError',
          selectionBar: 'fmSelectionBar',
          body: 'fmBody',
          tableWrap: 'fmTableWrap',
          table: 'fmTable',
          thead: 'fmThead',
          row: 'fmRow',
          rowSelected: 'fmRowSelected',
          rowName: 'fmRowName',
          rowIcon: 'fmRowIcon',
          checkCell: 'fmCheckCell',
          cellSize: 'fmCellSize',
          cellModified: 'fmCellModified',
          cellPerms: 'fmCellPerms',
          permBadge: 'fmPermBadge',
          permMatrix: 'fmPermMatrix',
          permPresets: 'fmPermPresets',
          permOctalRow: 'fmPermOctalRow',
          permPreview: 'fmPermPreview',
          permError: 'fmPermError',
          cellActions: 'fmCellActions',
          actionButton: 'fmActionButton',
          status: 'fmStatus',
          empty: 'fmEmpty',
          dragOver: 'fmDragOver',
          dialogBackdrop: 'fmDialogBackdrop',
          dialog: 'fmDialog',
          dialogTitle: 'fmDialogTitle',
          dialogBody: 'fmDialogBody',
          dialogActions: 'fmDialogActions',
          conflictList: 'fmConflictList',
          field: 'fmField',
          input: 'fmInput',
          errorText: 'fmErrorText',
          previewBackdrop: 'fmPreviewBackdrop',
          preview: 'fmPreview',
          previewHead: 'fmPreviewHead',
          previewTitle: 'fmPreviewTitle',
          previewBody: 'fmPreviewBody',
          previewText: 'fmPreviewText',
          editorArea: 'fmEditorArea',
          editorNote: 'fmEditorNote',
          searchModeSelect: 'fmSearchModeSelect',
          searchBanner: 'fmSearchBanner',
          matchMeta: 'fmMatchMeta',
          moveTargets: 'fmMoveTargets',
          dropTarget: 'fmDropTarget',
          previewImage: 'fmPreviewImage',
          previewFrame: 'fmPreviewFrame',
          links: 'fmLinks',
        }

        /** The stylesheet text, scoped by the `fm` prefix. */
        const STYLES = `
        .${css.page} {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
          min-height: 0;
          box-sizing: border-box;
          color: var(--dsw-alias-label-primary);
          background: var(--dsw-alias-bg-base);
          font-size: 13px;
          line-height: 1.5;
        }
        .${css.header} {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px 16px;
          padding: 20px 24px 12px;
          border-bottom: 0.5px solid var(--dsw-alias-border-l1);
        }
        .${css.headerText} { min-width: 0; }
        .${css.title} {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          line-height: 24px;
        }
        .${css.subtitle} {
          margin: 2px 0 0;
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
        }
        .${css.toolbar} {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .${css.breadcrumbRow} {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 24px 0;
        }
        .${css.addressForm} {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }
        .${css.addressInput}, .${css.input}, .${css.filterInput} {
          box-sizing: border-box;
          min-width: 0;
          padding: 5px 8px;
          border: 0.5px solid var(--dsw-alias-border-l2);
          border-radius: var(--dsw-radius-md, 6px);
          background: var(--dsw-alias-bg-layer-1);
          color: var(--dsw-alias-label-primary);
          font: inherit;
          font-size: 16px;
        }
        .${css.addressInput} { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
        .${css.addressInput}:focus-visible, .${css.input}:focus-visible, .${css.filterInput}:focus-visible {
          outline: 2px solid var(--dsw-alias-brand-primary);
          outline-offset: 1px;
        }
        .${css.button} {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border: 0.5px solid var(--dsw-alias-border-l2);
          border-radius: var(--dsw-radius-md, 6px);
          background: var(--dsw-alias-bg-layer-1);
          color: var(--dsw-alias-label-primary);
          font: inherit;
          font-weight: 500;
          white-space: nowrap;
          cursor: pointer;
        }
        .${css.button}:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
        .${css.button}:disabled { opacity: 0.5; cursor: default; }
        .${css.buttonPrimary} {
          border-color: transparent;
          background: var(--dsw-alias-brand-primary);
          color: var(--dsw-alias-bg-base);
        }
        .${css.buttonPrimary}:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: 0.9; }
        .${css.buttonDanger} { color: var(--dsw-alias-state-error-primary); }
        .${css.buttonDanger}:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
        .${css.buttonIcon} { padding: 5px 8px; }
        .${css.hiddenCheck} {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          box-sizing: border-box;
          padding: 5px 10px;
          border: 0.5px solid var(--dsw-alias-border-l2);
          border-radius: var(--dsw-radius-md, 6px);
          background: transparent;
          color: var(--dsw-alias-label-primary);
          font-size: 12px;
          font-weight: 500;
          line-height: 1;
          cursor: pointer;
          user-select: none;
          margin: 0;
          white-space: nowrap;
        }
        .${css.hiddenCheck}:hover { background: var(--dsw-alias-bg-layer-1); }
        .${css.hiddenCheck} input[type="checkbox"] {
          margin: 0;
          width: 14px;
          height: 14px;
          accent-color: var(--dsw-alias-brand-primary);
          cursor: pointer;
        }
        .${css.hiddenCheckDisabled} { opacity: 0.45; cursor: not-allowed; }
        .${css.hiddenCheckDisabled} input[type="checkbox"] { cursor: not-allowed; }
        .${css.breadcrumb} {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 2px;
          min-width: 0;
          padding: 8px 24px 0;
          font-size: 12px;
        }
        .${css.crumb} {
          max-width: 260px;
          padding: 2px 6px;
          border: 0;
          border-radius: var(--dsw-radius-sm, 4px);
          background: transparent;
          color: var(--dsw-alias-label-secondary);
          font: inherit;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: pointer;
        }
        .${css.crumb}:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
        .${css.crumbCurrent} { color: var(--dsw-alias-label-primary); font-weight: 600; }
        .${css.crumbSep} { color: var(--dsw-alias-label-secondary); user-select: none; }
        .${css.roots} {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          padding: 6px 24px 0;
          font-size: 12px;
          color: var(--dsw-alias-label-secondary);
        }
        .${css.rootChip} {
          padding: 1px 8px;
          border: 0.5px solid var(--dsw-alias-border-l1);
          border-radius: 999px;
          background: transparent;
          color: var(--dsw-alias-label-secondary);
          font: inherit;
          cursor: pointer;
        }
        .${css.rootChip}:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
        .${css.filterRow} {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 24px 0;
        }
        .${css.filterInput} { flex: 1; max-width: 320px; font-size: 13px; }
        .${css.notice} {
          margin: 8px 24px 0;
          padding: 6px 10px;
          border-radius: var(--dsw-radius-md, 6px);
          background: var(--dsw-alias-bg-layer-2);
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
        }
        .${css.noticeError} { color: var(--dsw-alias-state-error-primary); }
        .${css.selectionBar} {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 8px 24px 0;
          padding: 6px 10px;
          border-radius: var(--dsw-radius-md, 6px);
          background: var(--dsw-alias-bg-layer-2);
          color: var(--dsw-alias-label-primary);
          font-size: 12px;
        }
        .${css.body} {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          padding: 8px 24px 24px;
          overflow: auto;
        }
        .${css.tableWrap} {
          position: relative;
          flex: 1;
          min-height: 160px;
          border: 0.5px solid var(--dsw-alias-border-l1);
          border-radius: var(--dsw-radius-lg, 8px);
          background: var(--dsw-alias-bg-layer-1);
          overflow: auto;
        }
        .${css.dragOver} { outline: 2px dashed var(--dsw-alias-brand-primary); outline-offset: -4px; }
        .${css.table} { width: 100%; border-collapse: collapse; }
        .${css.thead} {
          position: sticky;
          top: 0;
          z-index: 1;
          background: var(--dsw-alias-bg-layer-2);
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
          font-weight: 500;
          text-align: left;
        }
        .${css.thead} th { padding: 7px 10px; font-weight: 500; border-bottom: 0.5px solid var(--dsw-alias-border-l1); }
        .${css.row} { cursor: default; }
        .${css.row} td { padding: 5px 10px; border-bottom: 0.5px solid var(--dsw-alias-border-l1); vertical-align: middle; }
        .${css.row}:hover { background: var(--dsw-alias-bg-layer-2); }
        .${css.rowSelected}, .${css.rowSelected}:hover { background: var(--dsw-alias-bg-layer-2); }
        .${css.rowName} {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          padding: 0;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
          max-width: 100%;
        }
        .${css.rowName}:hover { text-decoration: underline; }
        .${css.rowIcon} { flex: none; width: 16px; height: 16px; color: var(--dsw-alias-label-secondary); }
        .${css.rowName} span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .${css.checkCell} { width: 28px; }
        .${css.cellSize} { width: 96px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .${css.cellModified} { width: 150px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
        .${css.cellPerms} { width: 138px; white-space: nowrap; }
        .${css.permBadge} {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 6px;
          border: 0.5px solid transparent;
          border-radius: var(--dsw-radius-sm, 4px);
          background: transparent;
          color: var(--dsw-alias-label-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 12px;
          cursor: pointer;
        }
        .${css.permBadge}:hover, .${css.permBadge}:focus-visible {
          border-color: var(--dsw-alias-border-l2);
          background: var(--dsw-alias-bg-layer-1);
          color: var(--dsw-alias-brand-primary);
          outline: none;
        }
        .${css.permMatrix} {
          width: 100%;
          margin-top: 12px;
          border-collapse: collapse;
          font-size: 12px;
        }
        .${css.permMatrix} th, .${css.permMatrix} td {
          padding: 6px 8px;
          border-bottom: 0.5px solid var(--dsw-alias-border-l1);
          text-align: center;
          color: var(--dsw-alias-label-primary);
        }
        .${css.permMatrix} th:first-child, .${css.permMatrix} td:first-child {
          text-align: left;
          color: var(--dsw-alias-label-secondary);
          font-weight: 500;
        }
        .${css.permMatrix} input[type="checkbox"] {
          margin: 0;
          width: 15px;
          height: 15px;
          accent-color: var(--dsw-alias-brand-primary);
          cursor: pointer;
        }
        .${css.permPresets} {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 12px;
        }
        .${css.permOctalRow} {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .${css.permOctalRow} input {
          width: 110px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .${css.permPreview} {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 13px;
          color: var(--dsw-alias-label-secondary);
        }
        .${css.permError} { margin: 6px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
        .${css.cellActions} { width: 248px; text-align: right; white-space: nowrap; }
        .${css.actionButton} {
          padding: 2px 6px;
          margin-left: 2px;
          border: 0;
          border-radius: var(--dsw-radius-sm, 4px);
          background: transparent;
          color: var(--dsw-alias-label-secondary);
          font: inherit;
          font-size: 12px;
          cursor: pointer;
          opacity: 0;
        }
        .${css.row}:hover .${css.actionButton}, .${css.row}:focus-within .${css.actionButton} { opacity: 1; }
        .${css.actionButton}:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
        .${css.actionButton}:focus-visible { opacity: 1; outline: 2px solid var(--dsw-alias-brand-primary); }
        .${css.status} { padding: 16px; color: var(--dsw-alias-label-secondary); text-align: center; }
        .${css.empty} { padding: 32px 16px; color: var(--dsw-alias-label-secondary); text-align: center; }
        .${css.dialogBackdrop} {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: color-mix(in srgb, var(--dsw-alias-bg-base) 70%, transparent);
        }
        .${css.dialog} {
          width: min(420px, 100%);
          box-sizing: border-box;
          padding: 18px 20px;
          border: 0.5px solid var(--dsw-alias-border-l2);
          border-radius: var(--dsw-radius-lg, 10px);
          background: var(--dsw-alias-bg-layer-3);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        }
        .${css.dialogTitle} { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
        .${css.dialogBody} { color: var(--dsw-alias-label-secondary); font-size: 13px; }
        .${css.dialogActions} { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
        .${css.field} { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
        .${css.field} label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
        .${css.input} { font-size: 16px; }
        .${css.conflictList} {
          margin: 10px 0 0;
          padding: 0 0 0 18px;
          max-height: 160px;
          overflow: auto;
          color: var(--dsw-alias-label-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
        }
        .${css.errorText} { margin: 8px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
        .${css.previewBackdrop} {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent);
        }
        .${css.preview} {
          display: flex;
          flex-direction: column;
          width: min(900px, 100%);
          height: min(720px, 100%);
          box-sizing: border-box;
          border: 0.5px solid var(--dsw-alias-border-l2);
          border-radius: var(--dsw-radius-lg, 10px);
          background: var(--dsw-alias-bg-layer-3);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
          overflow: hidden;
        }
        .${css.previewHead} {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          border-bottom: 0.5px solid var(--dsw-alias-border-l1);
        }
        .${css.previewTitle} {
          margin: 0;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          font-weight: 600;
        }
        .${css.previewBody} {
          display: flex;
          flex: 1;
          min-height: 0;
          align-items: center;
          justify-content: center;
          padding: 12px;
          overflow: auto;
        }
        .${css.previewText} {
          align-self: stretch;
          flex: 1;
          margin: 0;
          overflow: auto;
          color: var(--dsw-alias-label-primary);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .${css.previewImage} { max-width: 100%; max-height: 100%; object-fit: contain; }
        .${css.previewFrame} { flex: 1; align-self: stretch; width: 100%; border: 0; background: var(--dsw-alias-bg-base); }
        .${css.editorArea} {
          flex: 1;
          align-self: stretch;
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          border: 0.5px solid var(--dsw-alias-border-l2);
          border-radius: var(--dsw-radius-md, 6px);
          background: var(--dsw-alias-bg-layer-1);
          color: var(--dsw-alias-label-primary);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12.5px;
          line-height: 1.6;
          resize: none;
        }
        .${css.editorArea}:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
        .${css.editorNote} {
          margin: 0;
          padding: 6px 14px;
          border-bottom: 0.5px solid var(--dsw-alias-border-l1);
          color: var(--dsw-alias-state-error-primary);
          font-size: 12px;
        }
        .${css.searchModeSelect} {
          padding: 5px 8px;
          border: 0.5px solid var(--dsw-alias-border-l2);
          border-radius: var(--dsw-radius-md, 6px);
          background: var(--dsw-alias-bg-layer-1);
          color: var(--dsw-alias-label-primary);
          font: inherit;
          font-size: 12px;
        }
        .${css.searchBanner} {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin: 8px 24px 0;
          padding: 6px 10px;
          border-radius: var(--dsw-radius-md, 6px);
          background: var(--dsw-alias-bg-layer-2);
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
        }
        .${css.matchMeta} {
          display: block;
          margin-top: 2px;
          color: var(--dsw-alias-label-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 420px;
        }
        .${css.moveTargets} {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 10px;
        }
        .${css.dropTarget} {
          outline: 1.5px dashed var(--dsw-alias-brand-primary);
          background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
        }
        .${css.links} { display: flex; gap: 8px; align-items: center; }
        `
      return { css: css, STYLES: STYLES }
    })()

    // locale
    __mods.locale = (() => {
        /**
         * File manager — page copy.
         *
         * DSH locale dictionaries are flat `key: string` maps: `t(key, params)`
         * substitutes `{name}` placeholders and never receives a function. Every
         * message with a value is therefore a template plus a params object at the
         * call site — a function value here reaches React as a child and blanks the
         * slot.
         */

        /** English copy for the file manager page. */
        const en = {
          // Panel and page.
          panel: 'Server files',
          title: 'Server files',
          subtitle: 'Browse, upload, download, and manage files on the machine running DSH.',

          // Toolbar.
          addressLabel: 'Directory path',
          addressPlaceholder: 'Type a directory path and press Enter',
          go: 'Go',
          up: 'Parent directory',
          refresh: 'Refresh',
          upload: 'Upload files',
          newFolder: 'New folder',
          uploading: 'Uploading…',
          dropHere: 'Drop files to upload here',
          selectedCount: '{count} selected',
          clearSelection: 'Clear selection',
          downloadSelected: 'Download',
          downloadSelectedZip: 'Download as ZIP',
          deleteSelected: 'Delete',
          searchPlaceholder: 'Filter this folder',
          rootsLabel: 'Shortcuts',
          rootCrumb: 'Root',
          hiddenShort: 'Hidden',
          toggleHidden: 'Show or hide dotfiles',
          hiddenForced: 'This Host always shows dotfiles',

          // Table.
          name: 'Name',
          size: 'Size',
          modified: 'Modified',
          permissions: 'Permissions',
          editPermissions: 'Edit permissions for {name}',
          actions: 'Actions',
          emptyFolder: 'This folder is empty.',
          truncated: 'Only the first entries are shown. Open a subfolder or use the path bar.',
          unaddressable: '{count} entry name(s) cannot be addressed by this page and are hidden.',
          loading: 'Loading…',
          loadFailed: 'This directory could not be opened.',
          unavailable: 'The file manager service is not available on this Host.',
          retry: 'Retry',
          selectRow: 'Select',
          filtered: 'empty — nothing matches “{filter}”',

          // Row actions.
          preview: 'Preview',
          editFile: 'Edit',
          editTruncated: 'Truncated files cannot be edited inline.',
          download: 'Download',
          move: 'Move',
          moveSelected: 'Move',
          rename: 'Rename',
          delete: 'Delete',

          // Dialogs.
          cancel: 'Cancel',
          confirm: 'Confirm',
          save: 'Save',
          newFolderTitle: 'New folder',
          newFolderLabel: 'Folder name',
          newFolderPlaceholder: 'Untitled folder',
          renameTitle: 'Rename',
          renameLabel: 'New name',
          deleteTitle: 'Delete',
          deleteConfirmOne: 'Delete “{name}”? This cannot be undone.',
          deleteConfirmMany: 'Delete these {count} items? This cannot be undone.',
          deleteFolderNote: 'Folders are deleted together with everything inside them.',
          overwriteTitle: 'Replace existing files?',
          overwriteBody: '{count} file(s) already exist in this folder. Replacing them cannot be undone.',
          overwrite: 'Replace',
          close: 'Close',

          // Feedback.
          uploadDone: '{count} file(s) uploaded.',
          uploadFailed: 'Upload failed: {reason}',
          deleteDone: '{count} item(s) deleted.',
          deletePartial: '{done} deleted, {failed} not deleted:',
          renameDone: 'Renamed.',
          createDone: 'Folder created.',
          permissionsDone: 'Permissions updated.',
          saveDone: 'File saved.',
          moveDone: '{count} item(s) moved.',
          movePartial: '{done} moved, {failed} not moved:',
          moveTitle: 'Move items',
          moveOneNote: 'Move “{name}” to:',
          moveManyNote: 'Move {count} item(s) to:',
          moveLabel: 'Destination folder',
          movePlaceholder: '/path/to/destination',
          moveQuickTargets: 'Quick folders',
          searchModeName: 'By name (recursive)',
          searchModeContent: 'By content (text)',
          searchSubfolders: 'Search',
          searching: 'Searching…',
          searchClear: 'Clear search',
          searchResultCount: 'Search “{query}”: {count} match(es)',
          searchResultTruncated: 'Results capped at limit; narrow your query.',
          searchEmpty: 'No matching entries found.',
          permissionsTitle: 'Permissions for {name}',
          permOctalLabel: 'Octal mode',
          permOctalHint: '3 or 4 octal digits (e.g. 755 or 0644)',
          permOwner: 'Owner',
          permGroup: 'Group',
          permOthers: 'Others',
          permRead: 'Read',
          permWrite: 'Write',
          permExec: 'Execute',
          permPresets: 'Quick presets',
          permPreset755: '755 (rwxr-xr-x)',
          permPreset644: '644 (rw-r--r--)',
          permPreset600: '600 (rw-------)',
          permPreset700: '700 (rwx------)',
          permInvalid: 'Enter a valid octal mode (000–7777).',
          actionFailed: 'Action failed: {reason}',

          // Preview.
          previewBinary: 'This file cannot be shown inline. Download it to open it.',
          previewTruncated: 'The preview shows the beginning of the file only.',
          previewFailed: 'The preview could not be loaded: {reason}',
          openInBrowser: 'Open in a new tab',
          downloadFile: 'Download',
        }

        /** Chinese copy for the file manager page. */
        const zh = {
          panel: '服务器文件',
          title: '服务器文件',
          subtitle: '浏览、上传、下载并管理运行 DSH 的这台机器上的文件。',

          addressLabel: '目录路径',
          addressPlaceholder: '输入目录路径并按回车',
          go: '前往',
          up: '上级目录',
          refresh: '刷新',
          upload: '上传文件',
          newFolder: '新建文件夹',
          uploading: '正在上传…',
          dropHere: '松开即可上传到当前目录',
          selectedCount: '已选择 {count} 项',
          clearSelection: '清除选择',
          downloadSelected: '下载',
          downloadSelectedZip: '打包下载 (ZIP)',
          deleteSelected: '删除',
          searchPlaceholder: '筛选当前目录',
          rootsLabel: '快捷入口',
          rootCrumb: '根目录',
          hiddenShort: '隐藏文件',
          toggleHidden: '显示/隐藏以点开头的文件',
          hiddenForced: '此 Host 已配置为始终显示隐藏文件',

          name: '名称',
          size: '大小',
          modified: '修改时间',
          permissions: '权限',
          editPermissions: '修改 {name} 的权限',
          actions: '操作',
          emptyFolder: '这个文件夹是空的。',
          truncated: '只显示了部分条目。可以进入子目录或直接用路径栏跳转。',
          unaddressable: '有 {count} 个条目的文件名本页无法表示，已隐藏。',
          loading: '加载中…',
          loadFailed: '无法打开这个目录。',
          unavailable: '当前 Host 上没有可用的文件管理服务。',
          retry: '重试',
          selectRow: '选择',
          filtered: '空——没有匹配“{filter}”的条目',

          preview: '预览',
          editFile: '编辑',
          editTruncated: '文件过大已被截断，暂不支持在线编辑。',
          download: '下载',
          move: '移动',
          moveSelected: '移动',
          rename: '重命名',
          delete: '删除',

          cancel: '取消',
          confirm: '确定',
          save: '保存',
          newFolderTitle: '新建文件夹',
          newFolderLabel: '文件夹名称',
          newFolderPlaceholder: '未命名文件夹',
          renameTitle: '重命名',
          renameLabel: '新名称',
          deleteTitle: '删除',
          deleteConfirmOne: '确定删除“{name}”吗？此操作无法撤销。',
          deleteConfirmMany: '确定删除这 {count} 项吗？此操作无法撤销。',
          deleteFolderNote: '文件夹会连同其中的所有内容一起删除。',
          overwriteTitle: '替换已有文件？',
          overwriteBody: '当前目录已有 {count} 个同名文件。替换后无法撤销。',
          overwrite: '替换',
          close: '关闭',

          uploadDone: '已上传 {count} 个文件。',
          uploadFailed: '上传失败：{reason}',
          deleteDone: '已删除 {count} 项。',
          deletePartial: '已删除 {done} 项，{failed} 项未删除：',
          renameDone: '已重命名。',
          createDone: '已创建文件夹。',
          permissionsDone: '权限已更新。',
          saveDone: '文件已保存。',
          moveDone: '已移动 {count} 项。',
          movePartial: '{done} 项已移动，{failed} 项失败：',
          moveTitle: '移动条目',
          moveOneNote: '将“{name}”移动到：',
          moveManyNote: '将这 {count} 项移动到：',
          moveLabel: '目标文件夹路径',
          movePlaceholder: '/path/to/destination',
          moveQuickTargets: '快速选择目录',
          searchModeName: '按名称搜索（递归）',
          searchModeContent: '按文件内容搜索（文本）',
          searchSubfolders: '全目录搜索',
          searching: '搜索中…',
          searchClear: '清空搜索',
          searchResultCount: '搜索“{query}”：共 {count} 条结果',
          searchResultTruncated: '结果数量已达上限，请缩小搜索范围。',
          searchEmpty: '未找到匹配的文件或目录。',
          permissionsTitle: '{name} 的权限',
          permOctalLabel: '八进制权限值',
          permOctalHint: '3 或 4 位八进制数字（如 755 或 0644）',
          permOwner: '所有者',
          permGroup: '用户组',
          permOthers: '其他人',
          permRead: '读取',
          permWrite: '写入',
          permExec: '执行',
          permPresets: '常用预设',
          permPreset755: '755 (rwxr-xr-x)',
          permPreset644: '644 (rw-r--r--)',
          permPreset600: '600 (rw-------)',
          permPreset700: '700 (rwx------)',
          permInvalid: '请输入有效的八进制权限值（000–7777）。',
          actionFailed: '操作失败：{reason}',

          previewBinary: '这个文件无法在页面内显示，请下载后打开。',
          previewTruncated: '预览只显示文件开头部分。',
          previewFailed: '预览加载失败：{reason}',
          openInBrowser: '在新标签页打开',
          downloadFile: '下载',
        }
      return { en: en, zh: zh }
    })()

    // icon
    __mods.icon = (() => {
        /**
         * File manager — sidebar glyph.
         *
         * A folder with a small drive bar, drawn as plain path data at the 36-unit
         * canvas Plugin Manager uses. The layers use `currentColor` with opacity, so
         * the sidebar's own ink colour decides how it looks in either theme.
         */

        /** Icon canvas. */
        const ICON_VIEWBOX = '0 0 36 36'

        /** Flat path definitions, back to front. */
        const ICON_PATHS = [
          // Folder back: a rounded tab and body, filled with a muted tint.
          {
            d: 'M7 12.5a2.5 2.5 0 0 1 2.5-2.5h6.2l2.6 3H26.5A2.5 2.5 0 0 1 29 15.5v10A2.5 2.5 0 0 1 26.5 28h-17A2.5 2.5 0 0 1 7 25.5v-13Z',
            fill: 'currentColor', fillOpacity: 0.9,
          },
          // Folder front: a lighter band across the lower half.
          {
            d: 'M7 18.5h22v7a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 7 25.5v-7Z',
            fill: 'currentColor', fillOpacity: 0.55,
          },
          // Drive slot: a dark rounded bar that reads as storage at row size.
          {
            d: 'M11.5 21h13a1.2 1.2 0 0 1 1.2 1.2v2.1a1.2 1.2 0 0 1-1.2 1.2h-13a1.2 1.2 0 0 1-1.2-1.2v-2.1A1.2 1.2 0 0 1 11.5 21Z',
            fill: 'currentColor', fillOpacity: 0.3,
          },
          // Status dot on the slot.
          {
            d: 'M21.6 24.25a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z',
            fill: 'currentColor',
            fillOpacity: 0.95,
          },
        ]
      return { ICON_VIEWBOX: ICON_VIEWBOX, ICON_PATHS: ICON_PATHS }
    })()

    // contract
    __mods.contract = (() => {
        /**
         * File manager — Typert wire descriptors.
         *
         * The published DSH build ships no Typert generator, so a plugin cannot emit
         * `typert.host.js` / `typert.remote-client.js` from TypeScript decorators.
         * The gateway still needs the Client half, so this module states it by hand
         * as a contribution handed to `ctx.remote.$mount()`, which installs
         * `remote.fileManager.*` as ordinary methods. The Host half needs no artifact
         * at all: the `fileManager` service marks its methods with the same
         * `@Remote` protocol marker a compiled service carries, and the Gateway
         * derives the endpoints from that marker directly.
         *
         * `SPECS` is therefore the wire contract's single authored source, and its
         * strict schemas validate both the named input and the result the Host sends.
         *
         * The bundle cannot import the protocol package, so the small part of
         * `createTypertRemoteInfo` this plugin uses is reimplemented below, keeping the
         * descriptor shape, the lazy `input()` and the `invoke()` path the Gateway
         * expects.
         */

        /** Package name that owns the endpoints. */
        const PACKAGE_NAME = '@metis/file-manager'
        /** Namespace both halves bind to. */
        const NAMESPACE = 'fileManager'

        /** `readonly { path }`. */
        const ackShape = z => z.object({ path: z.string() }).readonly()

        /**
         * The wire contract of every endpoint: ordered parameters and result schema.
         * Each entry is a factory over `zod` so both halves build fresh instances.
         */
        const SPECS = {
          list: {
            description: 'List one server directory: its direct children, the parent to offer, and the browsable roots.',
            parameters: [
              { name: 'path', description: 'Absolute directory path.', schema: z => z.string() },
              { name: 'showHidden', description: 'Include dot entries.', schema: z => z.boolean() },
            ],
            result: z => z.object({
              path: z.string(),
              parent: z.string().nullable(),
              roots: z.array(z.string()).readonly(),
              entries: z.array(z.object({
                name: z.string(),
                path: z.string(),
                type: z.enum(['file', 'directory', 'other']),
                size: z.number().int().nonnegative(),
                modified: z.number().nonnegative(),
                mode: z.number().int().nonnegative().optional(),
              }).readonly()).readonly(),
              truncated: z.boolean(),
              unaddressable: z.number().int().nonnegative(),
              hiddenForced: z.boolean(),
            }).readonly(),
          },
          createDirectory: {
            description: 'Create one directory under a parent directory.',
            parameters: [
              { name: 'parent', description: 'Absolute parent directory.', schema: z => z.string() },
              { name: 'name', description: 'New directory name.', schema: z => z.string() },
            ],
            result: ackShape,
          },
          rename: {
            description: 'Rename one file or directory in place.',
            parameters: [
              { name: 'path', description: 'Absolute path to rename.', schema: z => z.string() },
              { name: 'name', description: 'The new base name.', schema: z => z.string() },
            ],
            result: ackShape,
          },
          deleteEntries: {
            description: 'Delete files and directories; a directory is removed together with its contents. Every path is reported.',
            parameters: [
              { name: 'paths', description: 'Absolute paths to delete.', schema: z => z.array(z.string()) },
            ],
            result: z => z.array(z.object({
              path: z.string(),
              ok: z.boolean(),
              error: z.string().optional(),
            }).readonly()).readonly(),
          },
          preview: {
            description: 'Read one file for an inline preview as text, image or PDF bytes, or a binary notice.',
            parameters: [
              { name: 'path', description: 'Absolute file path.', schema: z => z.string() },
            ],
            result: z => z.object({
              path: z.string(),
              kind: z.enum(['text', 'image', 'pdf', 'binary']),
              mediaType: z.string(),
              text: z.string().optional(),
              size: z.number().int().nonnegative(),
              truncated: z.boolean(),
            }).readonly(),
          },
          startPath: {
            description: 'The directory the page opens at when it has no other preference.',
            parameters: [],
            result: z => z.string(),
          },
          chmod: {
            description: 'Change POSIX permission bits on one file or directory.',
            parameters: [
              { name: 'path', description: 'Absolute path to modify.', schema: z => z.string() },
              { name: 'mode', description: 'POSIX permission bits (0..4095 integer).', schema: z => z.number().int().min(0).max(0o7777) },
            ],
            result: z => z.object({
              path: z.string(),
              mode: z.number().int().nonnegative(),
            }).readonly(),
          },
          writeText: {
            description: 'Overwrite an existing text file with UTF-8 content.',
            parameters: [
              { name: 'path', description: 'Absolute file path.', schema: z => z.string() },
              { name: 'content', description: 'Full UTF-8 text content.', schema: z => z.string() },
            ],
            result: z => z.object({
              path: z.string(),
              size: z.number().int().nonnegative(),
              modified: z.number().nonnegative(),
            }).readonly(),
          },
          moveEntries: {
            description: 'Move files or directories into a destination directory.',
            parameters: [
              { name: 'paths', description: 'Absolute source paths to move.', schema: z => z.array(z.string()) },
              { name: 'destinationDir', description: 'Absolute destination directory path.', schema: z => z.string() },
            ],
            result: z => z.array(z.object({
              from: z.string(),
              path: z.string(),
              ok: z.boolean(),
              error: z.string().optional(),
            }).readonly()).readonly(),
          },
          search: {
            description: 'Search recursively inside a directory by entry name or file text content.',
            parameters: [
              { name: 'directory', description: 'Absolute directory path to search.', schema: z => z.string() },
              { name: 'query', description: 'Search substring.', schema: z => z.string() },
              { name: 'mode', description: 'Search by entry name or file text content.', schema: z => z.enum(['name', 'content']) },
              { name: 'showHidden', description: 'Include dotfiles in search results.', schema: z => z.boolean() },
            ],
            result: z => z.object({
              directory: z.string(),
              query: z.string(),
              mode: z.enum(['name', 'content']),
              truncated: z.boolean(),
              entries: z.array(z.object({
                name: z.string(),
                path: z.string(),
                relativePath: z.string(),
                type: z.enum(['file', 'directory', 'other']),
                size: z.number().int().nonnegative(),
                modified: z.number().nonnegative(),
                mode: z.number().int().nonnegative().optional(),
                matchLine: z.number().int().positive().optional(),
                matchText: z.string().optional(),
              }).readonly()).readonly(),
            }).readonly(),
          },
        }

        /**
         * One strict codec view of a schema factory.
         * @param factory - schema factory over `zod`.
         * @param z - the `zod` runtime.
         * @param typeSymbol - canonical symbol the generator would record.
         * @returns the codec.
         */
        function codec(factory, z, typeSymbol) {
          let cached
          return {
            mode: 'strict',
            typeSymbol,
            create: () => (cached ??= factory(z)),
          }
        }

        /**
         * Build the mountable Client contribution over the same wire contract.
         * @param z - the browser module table's `zod`.
         * @returns the contribution for `ctx.remote.$mount()`.
         */
        function clientContribution(z) {
          const methods = {}
          for (const [method, spec] of Object.entries(SPECS)) {
            const id = `${PACKAGE_NAME}#${NAMESPACE}/${method}`
            methods[`${NAMESPACE}/${method}`] = {
              service: NAMESPACE,
              description: spec.description,
              invocation: { kind: 'direct' },
              parameters: spec.parameters.map(parameter => {
                const symbol = `${id}:${parameter.name}`
                return {
                  name: parameter.name,
                  wire: parameter.name,
                  description: parameter.description,
                  source: 'json',
                  codec: codec(parameter.schema, z, symbol),
                  strictCodec: codec(parameter.schema, z, symbol),
                }
              }),
              cancellation: { parameter: 'signal' },
              result: codec(spec.result, z, `${id}:result`),
              sourceLocation: { file: 'file-manager/src/client/contract.js', line: 1, column: 1 },
            }
          }
          return createRemoteInfo({ package: PACKAGE_NAME, methods }, z)
        }

        /**
         * Build the lazy descriptor index and the direct client methods.
         * @param spec - package name and per-endpoint method facts.
         * @param z - zod runtime used for named-input parsing.
         * @returns `{ package, descriptors, methods }`.
         */
        function createRemoteInfo(spec, z) {
          let index
          return {
            package: spec.package,
            get descriptors() { return resolve().descriptors },
            get methods() { return resolve().methods },
          }

          /**
           * Materialize the descriptor index once.
           * @returns the descriptors and the callable methods.
           */
          function resolve() {
            if (index !== undefined) return index
            const descriptors = []
            const methods = Object.create(null)
            for (const [endpoint, definition] of Object.entries(spec.methods)) {
              const separator = endpoint.indexOf('/')
              const namespace = endpoint.slice(0, separator)
              const method = endpoint.slice(separator + 1)
              const parameters = definition.parameters.map(parameter => ({ ...parameter, wire: parameter.wire ?? parameter.name }))
              const descriptor = {
                ...definition,
                id: `${spec.package}#${endpoint}`,
                namespace,
                method,
                parameters,
              }
              if (definition.invocation.kind === 'direct') {
                let strictInput
                let looseInput
                const direct = Object.assign(descriptor, {
                  /**
                   * Named-input parser for this endpoint.
                   * @param options - strictness; omission keeps undeclared fields.
                   * @returns the cached parser view.
                   */
                  input(options) {
                    const strict = options?.strict === true
                    return strict ? (strictInput ??= namedInput(parameters, true, z)) : (looseInput ??= namedInput(parameters, false, z))
                  },
                  /**
                   * Call the mounted namespace method with named wire arguments.
                   * @param remote - the Client Remote service.
                   * @param input - named wire arguments.
                   * @param signal - caller-owned cancellation.
                   * @returns the namespace method's promise.
                   */
                  invoke(remote, input, signal) {
                    const values = parameters.map(parameter => input[parameter.wire])
                    if (definition.cancellation !== undefined) values.push(signal)
                    const receiver = remote[namespace]
                    return receiver[method](...values)
                  },
                })
                methods[endpoint] = direct
              }
              descriptors.push(descriptor)
            }
            index = { descriptors, methods }
            return index
          }
        }

        /**
         * Strict named-input parser over one endpoint's parameters.
         * @param parameters - ordered wire parameters.
         * @param strict - reject undeclared fields when true.
         * @param z - zod runtime.
         * @returns the cached parser view.
         */
        function namedInput(parameters, strict, z) {
          let schema
          return {
            /**
             * Materialize the parser.
             * @returns a zod object schema over the wire fields.
             */
            create() {
              return (schema ??= z.strictObject(Object.fromEntries(parameters.map(parameter => [
                parameter.wire,
                (strict ? parameter.strictCodec : parameter.codec).create(),
              ]))))
            },
          }
        }
      return { PACKAGE_NAME: PACKAGE_NAME, NAMESPACE: NAMESPACE, SPECS: SPECS, clientContribution: clientContribution }
    })()

    // page
    __mods.page = (() => {
        /**
         * File manager — the page component.
         *
         * A global main panel: the left sidebar's "Server files" row selects it, and it
         * owns the whole centre column. It does not depend on a workspace or Session,
         * so it renders and browses with no Session selected.
         *
         * Data comes from `ctx.remote.fileManager` (mounted by this plugin's own
         * client entry) and the three byte routes the Host half registers. React and
         * `react-dom` arrive through the module loader's `require`, so this component
         * imports nothing from other Harness client packages.
         */

        const { css, STYLES } = __mods.styles
        /**
         * Build the page component.
         * @param React - React from the shell's module table.
         * @param ReactDOM - react-dom from the shell's module table; its `createPortal`
         *   lifts dialogs to the document root, and is optional.
         * @returns the page component.
         */
        function createPageComponent({ React, ReactDOM }) {
          const h = React.createElement
          // Overlays live at the document root: the page sits inside the frame's
          // scrolled column, where a fixed layer would be clipped or stacked below the
          // shell. createPortal is optional so the component still renders without a DOM.
          const overlay = (node) => (ReactDOM?.createPortal && typeof document !== 'undefined'
            ? ReactDOM.createPortal(node, document.body)
            : node)
          const { useCallback, useEffect, useId, useMemo, useRef, useState } = React

          /**
           * Send one Remote call and unwrap its result.
           * @param call - a promise resolving to the Remote result envelope.
           * @returns the value, or a thrown `Error` carrying the Host's message.
           */
          const call = async (promise) => {
            const result = await promise
            if (result.ok) return result.value
            throw new Error(result.error?.message ?? String(result.error?.code ?? 'request failed'))
          }

          /**
           * Format a byte count for the size column.
           * @param bytes - size in bytes.
           * @returns a short human-readable size.
           */
          const formatSize = (bytes) => {
            if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
            const units = ['B', 'KB', 'MB', 'GB', 'TB']
            let value = bytes
            let unit = 0
            while (value >= 1024 && unit < units.length - 1) {
              value /= 1024
              unit += 1
            }
            return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
          }

          /**
           * Format one listing timestamp for the modified column.
           * @param value - epoch milliseconds, or 0 when the backend reported none.
           * @returns a short local date and time, or an empty string.
           */
          const formatTime = (value) => {
            if (typeof value !== 'number' || value <= 0) return ''
            const date = new Date(value)
            if (Number.isNaN(date.getTime())) return ''
            const pad = (part) => String(part).padStart(2, '0')
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
          }

          /**
           * Trim a deep breadcrumb trail to its root, an ellipsis, and the last
           * segments, so the current directory always stays visible.
           * @param crumbs - the full trail, root first.
           * @returns the trail to render.
           */
          const visibleCrumbs = (crumbs) => {
            const LIMIT = 5
            if (crumbs.length <= LIMIT + 1) return crumbs
            const tail = crumbs.slice(crumbs.length - LIMIT)
            const hidden = crumbs.slice(1, crumbs.length - LIMIT)
            return [
              crumbs[0],
              { ellipsis: true, title: hidden.map(crumb => crumb.name).join(' / ') },
              ...tail,
            ]
          }

          /**
           * Split an absolute POSIX path into breadcrumb segments.
           * @param path - absolute directory path.
           * @returns every ancestor prefix, root first.
           */
          const crumbsOf = (path, rootLabel) => {
            const parts = path.split('/').filter(Boolean)
            const crumbs = [{ name: rootLabel, path: '/' }]
            let current = ''
            for (const part of parts) {
              current += `/${part}`
              crumbs.push({ name: part, path: current })
            }
            return crumbs
          }

          /**
           * Render one small inline glyph.
           * @param props - glyph name.
           * @returns the SVG element.
           */
          const glyph = (name) => {
            const paths = {
              folder: h('path', { d: 'M2.5 5.5h4l1.2 1.5h5.8v6.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5.5Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
              file: h('path', { d: 'M4 2.5h5.5L12.5 5.5v8H4v-11Zm5.5 0v3h3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
              other: h('path', { d: 'M8 2.8l5 2.9v4.6l-5 2.9-5-2.9V5.7l5-2.9Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
              up: h('path', { d: 'M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              refresh: h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              close: h('path', { d: 'M4 4l8 8M12 4l-8 8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
              eye: h('path', {
                d: 'M1.8 8S4.4 3.8 8 3.8 14.2 8 14.2 8 11.6 12.2 8 12.2 1.8 8 1.8 8Z',
                fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
              }),
            }
            return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' }, paths[name] ?? paths.file)
          }

          /**
           * One dialog that traps Escape and restores focus to its opener.
           * @param props - open state, title, and body.
           * @returns the dialog element or null.
           */
          const Modal = ({ title, onClose, children, wide }) => {
            const ref = useRef(null)
            const restore = useRef(null)
            const headingId = useId()
            useEffect(() => {
              restore.current = document.activeElement
              const first = ref.current?.querySelector('input, button')
              if (first instanceof HTMLElement) first.focus()
              return () => {
                const target = restore.current
                if (target instanceof HTMLElement && target.isConnected) target.focus()
              }
            }, [])
            useEffect(() => {
              const onKey = (event) => {
                if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
                if (event.key !== 'Tab') return
                // Keep keyboard focus inside the dialog: aria-modal alone does not.
                const focusable = ref.current?.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')
                if (focusable === undefined || focusable.length === 0) return
                const first = focusable[0]
                const last = focusable[focusable.length - 1]
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
              }
              document.addEventListener('keydown', onKey, true)
              return () => { document.removeEventListener('keydown', onKey, true) }
            }, [onClose])
            return h('div', { className: css.dialogBackdrop, role: 'presentation', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
              h('div', { ref, className: wide ? css.preview : css.dialog, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': headingId },
                title === undefined ? null : h('h2', { id: headingId, className: css.dialogTitle }, title),
                children),
            )
          }

          /**
           * The file manager page.
           * @param props - main-slot props: Remote face, locale, and layout.
           * @returns the page.
           */
          function FileManagerPage(props) {
            const { t, fileManager } = props
            const [path, setPath] = useState(null)
            const [listing, setListing] = useState({ status: 'idle', value: null, error: null })
            const [draftPath, setDraftPath] = useState('')
            const [filter, setFilter] = useState('')
            const [selected, setSelected] = useState(() => new Set())
            const [busy, setBusy] = useState(false)
            const [notice, setNotice] = useState(null)
            const [dialog, setDialog] = useState(null)
            const [preview, setPreview] = useState(null)
            const [dragging, setDragging] = useState(false)
            const [reloads, setReloads] = useState(0)
            const [searchMode, setSearchMode] = useState('name')
            const [searchResult, setSearchResult] = useState(null)
            const [searching, setSearching] = useState(false)
            const [dropTargetPath, setDropTargetPath] = useState(null)
            const [showHidden, setShowHidden] = useState(() => {
              try {
                return window.localStorage.getItem('dsh.file-manager.showHidden') === '1'
              } catch {
                return false
              }
            })
            const titleId = useId()
            const fileInput = useRef(null)
            const dragDepth = useRef(0)

            const api = useMemo(() => fileManager, [fileManager])

            const noticeTimer = useRef(null)
            const showNotice = useCallback((kind, text) => {
              setNotice({ kind, text })
              if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
              if (kind === 'info') return
              noticeTimer.current = window.setTimeout(() => {
                noticeTimer.current = null
                setNotice(null)
              }, 6000)
            }, [])
            useEffect(() => () => {
              if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
            }, [])

            // The page opens at the Host's start directory, once per mount.
            useEffect(() => {
              if (api === undefined) return undefined
              let cancelled = false
              void (async () => {
                try {
                  const start = await call(api.startPath())
                  if (!cancelled) setPath(start)
                } catch (error) {
                  if (!cancelled) setListing({ status: 'error', value: null, error: String(error.message ?? error) })
                }
              })()
              return () => { cancelled = true }
            }, [api])

            // Every directory change and every reload re-reads the listing; the last
            // request wins, and a failure never navigates away from the typed path.
            useEffect(() => {
              if (path === null || api === undefined) return undefined
              let cancelled = false
              setListing((current) => ({ ...current, status: 'loading' }))
              setSelected(new Set())
              setFilter('')
              setDraftPath(path)
              void (async () => {
                try {
                  const value = await call(api.list(path, showHidden))
                  if (cancelled) return
                  setListing({ status: 'ready', value, error: null })
                  // The Host resolves symlinks and normalizes the path it reports.
                  if (value.path !== path) setPath(value.path)
                } catch (error) {
                  // Keep showing the directory this page is really in: the breadcrumbs
                  // and path bar are read from `path`, so a failed navigation restores
                  // the previous one instead of pairing new crumbs with old rows.
                  if (cancelled) return
                  setListing({ status: 'error', value: null, error: String(error.message ?? error) })
                  showNotice('error', t('loadFailed'))
                }
              })()
              return () => { cancelled = true }
            }, [api, path, reloads, showHidden])

            /** Re-read the current directory without leaving it. */
            const reload = useCallback(() => { setReloads(count => count + 1) }, [])

            /** Flip the dot-entry preference and re-read the directory. */
            const toggleHidden = useCallback(() => {
              setShowHidden((current) => {
                const next = !current
                try {
                  window.localStorage.setItem('dsh.file-manager.showHidden', next ? '1' : '0')
                } catch {
                  // Private-mode storage failures keep the choice for this page only.
                }
                return next
              })
              setReloads(count => count + 1)
            }, [])

            const navigate = useCallback((next) => {
              if (typeof next !== 'string' || next.trim() === '') return
              setSearchResult(null)
              setPath(next.trim())
            }, [])

            if (api === undefined) {
              return h('section', { className: css.page },
                h('style', null, STYLES),
                h('p', { className: css.status, role: 'alert' }, t('unavailable')),
              )
            }

            const entries = listing.value?.entries ?? []
            const visible = searchResult !== null
              ? searchResult.entries
              : (filter.trim() === ''
                ? entries
                : entries.filter(entry => entry.name.toLowerCase().includes(filter.trim().toLowerCase())))

            const allSelected = visible.length > 0 && visible.every(entry => selected.has(entry.path))
            const someSelected = selected.size > 0

            const toggle = useCallback((entryPath) => {
              setSelected((current) => {
                const next = new Set(current)
                if (next.has(entryPath)) next.delete(entryPath)
                else next.add(entryPath)
                return next
              })
            }, [])

            const toggleAll = useCallback(() => {
              setSelected((current) => {
                if (visible.length > 0 && visible.every(entry => current.has(entry.path))) return new Set()
                return new Set(visible.map(entry => entry.path))
              })
            }, [visible])

            /**
             * Start downloading one path through the Host route.
             * @param entryPath - absolute file path.
             */
            const download = useCallback((entryPath) => {
              const anchor = document.createElement('a')
              anchor.href = `api/file-manager.download?path=${encodeURIComponent(entryPath)}`
              anchor.download = entryPath.split('/').pop() ?? 'download'
              anchor.rel = 'noopener'
              anchor.click()
            }, [])

            /**
             * Download a selection as one archive. A single file downloads directly;
             * a directory, or several entries, arrives as one ZIP so the browser only
             * starts one download.
             * @param paths - absolute paths to include.
             */
            const downloadArchive = useCallback((paths) => {
              if (paths.length === 0) return
              const anchor = document.createElement('a')
              anchor.href = `api/file-manager.zip?${paths.map(path => `path=${encodeURIComponent(path)}`).join('&')}`
              anchor.download = paths.length === 1 ? `${paths[0].split('/').pop() || 'files'}.zip` : 'selection.zip'
              anchor.rel = 'noopener'
              anchor.click()
            }, [])

            /**
             * Download one row: files directly, directories as an archive.
             * @param entry - the row to download.
             */
            const downloadEntry = useCallback((entry) => {
              if (entry.type === 'directory') downloadArchive([entry.path])
              else download(entry.path)
            }, [download, downloadArchive])

            /**
             * Upload the chosen files into the current directory.
             * @param files - browser files to send.
             */
            const upload = useCallback(async (files, overwrite = false) => {
              const list = [...files]
              if (list.length === 0 || path === null) return
              setBusy(true)
              setNotice({ kind: 'info', text: t('uploading') })
              try {
                const body = new FormData()
                for (const file of list) body.append('files', file, file.name)
                const query = `dir=${encodeURIComponent(path)}${overwrite ? '&overwrite=1' : ''}`
                const response = await fetch(`api/file-manager.upload?${query}`, {
                  method: 'POST',
                  body,
                  credentials: 'same-origin',
                })
                const payload = await response.json().catch(() => ({}))
                if (response.status === 409) {
                  // Nothing was written: confirm the replacement before retrying.
                  setDialog({ kind: 'overwrite', files: list, names: payload.conflicts ?? [] })
                  return
                }
                if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
                showNotice('ok', t('uploadDone', { count: payload.files?.length ?? list.length }))
                reload()
              } catch (error) {
                showNotice('error', t('uploadFailed', { reason: String(error.message ?? error) }))
              } finally {
                setBusy(false)
              }
            }, [path, reload, showNotice, t])

            const openEntry = useCallback((entry) => {
              if (entry.type === 'directory') navigate(entry.path)
              else if (entry.type === 'file') setPreview({ path: entry.path, name: entry.name, state: { status: 'loading' } })
            }, [navigate])

            // Preview loads on demand, one request per opened file.
            useEffect(() => {
              if (api === undefined || preview === null || preview.state.status !== 'loading') return undefined
              let cancelled = false
              void call(api.preview(preview.path))
                .then((value) => {
                  if (cancelled) return
                  // Bytes never ride the Remote channel: image and PDF previews point
                  // the browser at the streamed raw route instead.
                  const url = value.kind === 'image' || value.kind === 'pdf'
                    ? `api/file-manager.raw?path=${encodeURIComponent(preview.path)}`
                    : undefined
                  setPreview(current => current === null ? null : ({ ...current, state: { status: 'ready', value, url } }))
                })
                .catch((error) => {
                  if (!cancelled) setPreview(current => current === null ? null : ({ ...current, state: { status: 'error', error: String(error.message ?? error) } }))
                })
              return () => { cancelled = true }
            }, [api, preview])

            /**
             * Run one mutating action and report its outcome.
             * @param run - the action.
             * @param done - the success message.
             */
            const act = useCallback(async (run, done) => {
              setBusy(true)
              try {
                await run()
                showNotice('ok', done)
                reload()
              } catch (error) {
                showNotice('error', t('actionFailed', { reason: String(error.message ?? error) }))
              } finally {
                setBusy(false)
              }
            }, [reload, showNotice, t])

            const submitNewFolder = useCallback((name) => {
              setDialog(null)
              void act(() => call(api.createDirectory(path, name)), t('createDone'))
            }, [act, api, path, t])

            const submitRename = useCallback((entry, name) => {
              setDialog(null)
              if (name === entry.name) return
              void act(() => call(api.rename(entry.path, name)), t('renameDone'))
            }, [act, api, t])

            const submitChmod = useCallback((entry, mode) => {
              setDialog(null)
              if (typeof entry.mode === 'number' && mode === entry.mode) return
              void act(() => call(api.chmod(entry.path, mode)), t('permissionsDone'))
            }, [act, api, t])

            const submitDelete = useCallback((paths) => {
              setDialog(null)
              void act(async () => {
                const results = await call(api.deleteEntries(paths))
                const failed = results.filter(entry => !entry.ok)
                if (failed.length > 0) {
                  // Some entries stayed: say which, instead of claiming success.
                  throw new Error(`${t('deletePartial', { failed: failed.length, done: results.length - failed.length })} ${failed.map(entry => entry.path).join(', ')}`)
                }
              }, t('deleteDone', { count: paths.length }))
            }, [act, api, t])

            const submitMove = useCallback((paths, destinationDir) => {
              setDialog(null)
              void act(async () => {
                const results = await call(api.moveEntries(paths, destinationDir))
                const failed = results.filter(entry => !entry.ok)
                if (failed.length > 0) {
                  throw new Error(`${t('movePartial', { failed: failed.length, done: results.length - failed.length })} ${failed.map(entry => entry.from).join(', ')}`)
                }
                setSelected(new Set())
              }, t('moveDone', { count: paths.length }))
            }, [act, api, t])

            const savePreviewText = useCallback(async (entryPath, content) => {
              const saved = await call(api.writeText(entryPath, content))
              setPreview(curr => curr && curr.path === entryPath && curr.state.status === 'ready'
                ? {
                  ...curr,
                  state: {
                    ...curr.state,
                    value: { ...curr.state.value, text: content, size: saved.size, truncated: false },
                  },
                }
                : curr)
              showNotice('ok', t('saveDone'))
              reload()
            }, [api, reload, showNotice, t])

            const runSearch = useCallback(async (rawQuery = filter, rawMode = searchMode) => {
              const trimmed = rawQuery.trim()
              if (trimmed === '' || path === null) {
                setSearchResult(null)
                return
              }
              setSearching(true)
              try {
                const result = await call(api.search(path, trimmed, rawMode, showHidden))
                setSearchResult(result)
              } catch (error) {
                showNotice('error', t('actionFailed', { reason: String(error.message ?? error) }))
              } finally {
                setSearching(false)
              }
            }, [api, filter, path, searchMode, showHidden, showNotice, t])

            const INTERNAL_DRAG_MIME = 'application/x-fm-paths'
            const dropOnTargetProps = (targetDir) => ({
              onDragOver: (event) => {
                if (!event.dataTransfer?.types?.includes(INTERNAL_DRAG_MIME)) return
                event.preventDefault()
                event.stopPropagation()
                setDropTargetPath(targetDir)
              },
              onDragLeave: (event) => {
                if (event.currentTarget?.contains?.(event.relatedTarget)) return
                setDropTargetPath(curr => (curr === targetDir ? null : curr))
              },
              onDrop: (event) => {
                const raw = event.dataTransfer?.getData(INTERNAL_DRAG_MIME)
                if (!raw) return
                event.preventDefault()
                event.stopPropagation()
                setDropTargetPath(null)
                try {
                  const paths = JSON.parse(raw)
                  if (Array.isArray(paths) && paths.length > 0 && !paths.includes(targetDir)) {
                    submitMove(paths, targetDir)
                  }
                } catch {
                  // Ignore malformed internal drag data.
                }
              },
            })

            // Escape closes the preview; the dialogs own their own Escape handling.
            useEffect(() => {
              if (preview === null) return undefined
              const onKey = (event) => { if (event.key === 'Escape') setPreview(null) }
              document.addEventListener('keydown', onKey)
              return () => { document.removeEventListener('keydown', onKey) }
            }, [preview])

            const onDragEnter = (event) => {
              if (!event.dataTransfer?.types?.includes('Files')) return
              dragDepth.current += 1
              setDragging(true)
            }
            const onDragLeave = () => {
              dragDepth.current = Math.max(0, dragDepth.current - 1)
              if (dragDepth.current === 0) setDragging(false)
            }
            const onDragOver = (event) => {
              if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
            }
            const onDrop = (event) => {
              if (!event.dataTransfer?.files?.length) return
              event.preventDefault()
              dragDepth.current = 0
              setDragging(false)
              if (busy) {
                showNotice('info', t('uploading'))
                return
              }
              void upload(event.dataTransfer.files)
            }

            const crumbs = crumbsOf(path ?? '/', t('rootCrumb'))
            const roots = listing.value?.roots ?? []
            const activePath = listing.value?.path ?? path
            const tableLabel = path ?? '/'

            return h('section', { className: css.page, 'aria-labelledby': titleId, 'aria-busy': busy || listing.status === 'loading' },
              h('style', null, STYLES),

              h('header', { className: css.header, 'data-window-drag': '' },
                h('div', { className: css.headerText },
                  h('h1', { id: titleId, className: css.title }, t('title')),
                  h('p', { className: css.subtitle }, t('subtitle')),
                ),
                h('div', { className: css.toolbar },
                  h('button', {
                    type: 'button', className: `${css.button} ${css.buttonPrimary}`,
                    onClick: () => { fileInput.current?.click() }, disabled: busy || path === null,
                  }, glyph('file'), busy ? t('uploading') : t('upload')),
                  h('input', {
                    ref: fileInput, type: 'file', multiple: true, hidden: true,
                    onChange: (event) => {
                      const files = event.target.files
                      if (files) void upload(files)
                      event.target.value = ''
                    },
                  }),
                  h('button', {
                    type: 'button', className: css.button,
                    onClick: () => setDialog({ kind: 'new-folder', value: '' }), disabled: busy || path === null,
                  }, t('newFolder')),
                  h('label', {
                    className: `${css.hiddenCheck}${path === null || listing.value?.hiddenForced === true ? ` ${css.hiddenCheckDisabled}` : ''}`,
                    title: listing.value?.hiddenForced === true ? t('hiddenForced') : t('toggleHidden'),
                  },
                  h('input', {
                    type: 'checkbox',
                    checked: showHidden || listing.value?.hiddenForced === true,
                    disabled: path === null || listing.value?.hiddenForced === true,
                    onChange: toggleHidden,
                    'aria-label': t('toggleHidden'),
                  }),
                  h('span', null, t('hiddenShort')),
                  ),
                  h('button', {
                    type: 'button', className: `${css.button} ${css.buttonIcon}`,
                    onClick: reload, disabled: path === null, title: t('refresh'), 'aria-label': t('refresh'),
                  }, glyph('refresh')),
                ),
              ),

              h('div', { className: css.breadcrumbRow },
                h('button', {
                  type: 'button', className: `${css.button} ${css.buttonIcon}`,
                  onClick: () => navigate(listing.value?.parent ?? path), disabled: !listing.value?.parent,
                  title: t('up'), 'aria-label': t('up'),
                }, glyph('up')),
                h('form', {
                  className: css.addressForm,
                  onSubmit: (event) => { event.preventDefault(); navigate(draftPath) },
                },
                  h('label', { hidden: true, htmlFor: `${titleId}-address` }, t('addressLabel')),
                  h('input', {
                    id: `${titleId}-address`, className: css.addressInput, value: draftPath,
                    placeholder: t('addressPlaceholder'), spellCheck: false, autoComplete: 'off',
                    'aria-label': t('addressLabel'),
                    onChange: (event) => { setDraftPath(event.target.value) },
                  }),
                  h('button', { type: 'submit', className: css.button, disabled: draftPath.trim() === '' }, t('go')),
                ),
              ),

              h('nav', { className: css.breadcrumb, 'aria-label': t('title') },
                visibleCrumbs(crumbs).map((crumb, index, shown) => {
                  const last = index === shown.length - 1
                  if (crumb.ellipsis === true) {
                    return h('span', { key: `gap-${index}`, className: css.crumbSep, title: crumb.title }, '…')
                  }
                  return h(React.Fragment, { key: crumb.path },
                    index > 0 ? h('span', { className: css.crumbSep, 'aria-hidden': 'true' }, '/') : null,
                    h('button', {
                      type: 'button',
                      className: `${css.crumb}${last ? ` ${css.crumbCurrent}` : ''}${!last && dropTargetPath === crumb.path ? ` ${css.dropTarget}` : ''}`,
                      'aria-current': last ? 'page' : undefined,
                      title: crumb.path,
                      onClick: () => { if (!last) navigate(crumb.path) },
                      ...(!last ? dropOnTargetProps(crumb.path) : {}),
                    }, crumb.name),
                  )
                }),
              ),

              roots.length > 0
                ? h('div', { className: css.roots },
                  h('span', null, `${t('rootsLabel')}:`),
                  roots.map(root => h('button', {
                    key: root, type: 'button', className: css.rootChip, title: root,
                    onClick: () => navigate(root),
                  }, root === '/' ? t('rootCrumb') : root)),
                )
                : null,

              h('div', { className: css.filterRow },
                h('input', {
                  className: css.filterInput, value: filter, spellCheck: false,
                  placeholder: t('searchPlaceholder'), 'aria-label': t('searchPlaceholder'),
                  onChange: (event) => {
                    const val = event.target.value
                    setFilter(val)
                    if (val.trim() === '') setSearchResult(null)
                  },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && filter.trim() !== '') {
                      event.preventDefault()
                      void runSearch(filter, searchMode)
                    }
                  },
                }),
                h('select', {
                  className: css.searchModeSelect,
                  value: searchMode,
                  'aria-label': t('searchSubfolders'),
                  onChange: (event) => { setSearchMode(event.target.value) },
                },
                h('option', { value: 'name' }, t('searchModeName')),
                h('option', { value: 'content' }, t('searchModeContent')),
                ),
                h('button', {
                  type: 'button',
                  className: css.button,
                  disabled: searching || path === null || filter.trim() === '',
                  onClick: () => { void runSearch(filter, searchMode) },
                }, searching ? t('searching') : t('searchSubfolders')),
                searchResult !== null
                  ? h('button', {
                    type: 'button',
                    className: css.button,
                    onClick: () => { setSearchResult(null) },
                  }, t('searchClear'))
                  : null,
              ),

              searchResult !== null
                ? h('div', { className: css.searchBanner, role: 'status' },
                  h('span', null,
                    t('searchResultCount', { query: searchResult.query, count: searchResult.entries.length }),
                    searchResult.truncated ? ` · ${t('searchResultTruncated')}` : ''),
                  h('button', {
                    type: 'button',
                    className: css.actionButton,
                    onClick: () => { setSearchResult(null) },
                  }, t('searchClear')),
                )
                : null,

              notice !== null
                ? h('p', {
                  className: `${css.notice}${notice.kind === 'error' ? ` ${css.noticeError}` : ''}`,
                  role: notice.kind === 'error' ? 'alert' : 'status',
                }, notice.text)
                : null,

              someSelected
                ? h('div', { className: css.selectionBar },
                  h('span', null, t('selectedCount', { count: selected.size })),
                  h('button', {
                    type: 'button', className: css.button,
                    onClick: () => downloadArchive([...selected]),
                  }, selected.size === 1 ? t('downloadSelected') : t('downloadSelectedZip')),
                  h('button', {
                    type: 'button', className: css.button,
                    onClick: () => setDialog({
                      kind: 'move',
                      paths: [...selected],
                      names: [...selected].map((entryPath) => entries.find(item => item.path === entryPath)?.name ?? entryPath),
                      dest: path ?? '',
                    }),
                  }, t('moveSelected')),
                  h('button', {
                    type: 'button', className: `${css.button} ${css.buttonDanger}`,
                    onClick: () => setDialog({ kind: 'delete', paths: [...selected], names: [...selected].map((entryPath) => entries.find(item => item.path === entryPath)?.name ?? entryPath) }),
                  }, t('deleteSelected')),
                  h('button', { type: 'button', className: css.button, onClick: () => setSelected(new Set()) }, t('clearSelection')),
                )
                : null,

              h('div', {
                className: css.body,
                onDragEnter: onDragEnter, onDragOver: onDragOver, onDragLeave: onDragLeave, onDrop: onDrop,
              },
                h('div', {
                  className: `${css.tableWrap}${dragging ? ` ${css.dragOver}` : ''}`,
                  'data-dragging': dragging ? '' : undefined,
                },
                  listing.status === 'loading' && listing.value === null
                    ? h('p', { className: css.status, role: 'status' }, t('loading'))
                    : null,
                  listing.status === 'error'
                    ? h('div', { className: css.status, role: 'alert' },
                      h('p', null, `${t('loadFailed')} ${listing.error ?? ''}`),
                      h('button', { type: 'button', className: css.button, onClick: reload }, t('retry')))
                    : null,
                  listing.value !== null
                    ? h('table', { key: tableLabel, className: css.table, 'aria-label': tableLabel },
                      h('thead', { className: css.thead },
                        h('tr', null,
                          h('th', { className: css.checkCell },
                            h('input', {
                              type: 'checkbox', checked: allSelected,
                              'aria-label': t('selectRow'), onChange: toggleAll,
                            })),
                          h('th', null, t('name')),
                          h('th', { className: css.cellSize }, t('size')),
                          h('th', { className: css.cellModified }, t('modified')),
                          h('th', { className: css.cellPerms }, t('permissions')),
                          h('th', { className: css.cellActions }, h('span', { hidden: true }, t('actions'))),
                        ),
                      ),
                      h('tbody', { key: tableLabel },
                        visible.length === 0
                          ? h('tr', null, h('td', { colSpan: 6, className: css.empty },
                            searchResult !== null
                              ? t('searchEmpty')
                              : (filter.trim() === '' ? t('emptyFolder') : t('filtered', { filter: filter.trim() }))))
                          : visible.map(entry => h('tr', {
                            key: entry.path,
                            className: `${css.row}${selected.has(entry.path) ? ` ${css.rowSelected}` : ''}${entry.type === 'directory' && dropTargetPath === entry.path ? ` ${css.dropTarget}` : ''}`,
                            draggable: searchResult === null && path !== null,
                            onDragStart: (event) => {
                              const dragPaths = selected.has(entry.path) ? [...selected] : [entry.path]
                              event.dataTransfer?.setData(INTERNAL_DRAG_MIME, JSON.stringify(dragPaths))
                              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
                            },
                            ...(entry.type === 'directory' && searchResult === null ? dropOnTargetProps(entry.path) : {}),
                            onDoubleClick: () => { openEntry(entry) },
                          },
                          h('td', { className: css.checkCell },
                            h('input', {
                              type: 'checkbox', checked: selected.has(entry.path),
                              'aria-label': `${t('selectRow')}: ${entry.name}`,
                              onChange: () => { toggle(entry.path) },
                            })),
                          h('td', null,
                            h('button', {
                              type: 'button', className: css.rowName,
                              onClick: () => { openEntry(entry) },
                              title: entry.path,
                            },
                            h('span', { className: css.rowIcon }, glyph(entry.type === 'directory' ? 'folder' : entry.type === 'file' ? 'file' : 'other')),
                            h('span', null, entry.relativePath ?? entry.name)),
                            entry.matchLine !== undefined
                              ? h('span', { className: css.matchMeta }, `L${entry.matchLine}: ${entry.matchText ?? ''}`)
                              : null,
                          ),
                          h('td', { className: css.cellSize }, entry.type === 'file' ? formatSize(entry.size) : ''),
                          h('td', { className: css.cellModified }, formatTime(entry.modified)),
                          h('td', { className: css.cellPerms },
                            typeof entry.mode === 'number'
                              ? h('button', {
                                type: 'button',
                                className: css.permBadge,
                                title: t('editPermissions', { name: entry.name }),
                                'aria-label': t('editPermissions', { name: entry.name }),
                                onClick: () => setDialog({ kind: 'chmod', entry }),
                              }, `${formatSymbolicMode(entry.mode)} ${formatOctalMode(entry.mode)}`)
                              : ''),
                          h('td', { className: css.cellActions },
                            entry.type === 'file'
                              ? h(React.Fragment, null,
                                h('button', { type: 'button', className: css.actionButton, onClick: () => setPreview({ path: entry.path, name: entry.name, state: { status: 'loading' } }) }, t('preview')),
                                h('button', { type: 'button', className: css.actionButton, onClick: () => { downloadEntry(entry) } }, t('download')),
                              )
                              : null,
                            entry.type === 'directory'
                              ? h('button', { type: 'button', className: css.actionButton, onClick: () => { downloadEntry(entry) } }, t('download'))
                              : null,
                            h('button', {
                              type: 'button', className: css.actionButton,
                              onClick: () => setDialog({ kind: 'chmod', entry }),
                            }, t('permissions')),
                            h('button', {
                              type: 'button', className: css.actionButton,
                              onClick: () => setDialog({ kind: 'move', paths: [entry.path], names: [entry.name], dest: path ?? '' }),
                            }, t('move')),
                            h('button', {
                              type: 'button', className: css.actionButton,
                              onClick: () => setDialog({ kind: 'rename', entry, value: entry.name }),
                            }, t('rename')),
                            h('button', {
                              type: 'button', className: css.actionButton,
                              onClick: () => setDialog({ kind: 'delete', paths: [entry.path], names: [entry.name] }),
                            }, t('delete')),
                          ),
                        )),
                      ),
                    )
                    : null,
                ),
                listing.value?.truncated ? h('p', { className: css.notice }, t('truncated')) : null,
                listing.value?.unaddressable > 0
                  ? h('p', { className: css.notice }, t('unaddressable', { count: listing.value.unaddressable }))
                  : null,
                dragging ? h('p', { className: css.notice, role: 'status' }, t('dropHere')) : null,
              ),

              dialog?.kind === 'new-folder'
                ? h(Modal, { title: t('newFolderTitle'), onClose: () => setDialog(null) },
                  h(NameForm, {
                    key: 'new-folder', label: t('newFolderLabel'), placeholder: t('newFolderPlaceholder'),
                    initial: '', submitLabel: t('confirm'), cancelLabel: t('cancel'),
                    onSubmit: submitNewFolder, onCancel: () => setDialog(null),
                  }))
                : null,
              dialog?.kind === 'rename'
                ? h(Modal, { title: t('renameTitle'), onClose: () => setDialog(null) },
                  h(NameForm, {
                    key: `rename-${dialog.entry.path}`, label: t('renameLabel'), placeholder: dialog.entry.name,
                    initial: dialog.value, submitLabel: t('save'), cancelLabel: t('cancel'),
                    unchanged: name => name.trim() === dialog.entry.name,
                    onSubmit: name => submitRename(dialog.entry, name), onCancel: () => setDialog(null),
                  }))
                : null,
              dialog?.kind === 'overwrite'
                ? h(Modal, { title: t('overwriteTitle'), onClose: () => setDialog(null) },
                  h('p', { className: css.dialogBody }, t('overwriteBody', { count: dialog.names.length })),
                  h('ul', { className: css.conflictList }, dialog.names.slice(0, 8).map(name => h('li', { key: name }, name))),
                  h('div', { className: css.dialogActions },
                    h('button', { type: 'button', className: css.button, onClick: () => { const files = dialog.files; setDialog(null); void upload(files, false) } }, t('cancel')),
                    h('button', {
                      type: 'button',
                      className: `${css.button} ${css.buttonDanger}`,
                      onClick: () => { const files = dialog.files; setDialog(null); void upload(files, true) },
                    }, t('overwrite')),
                  ))
                : null,
              dialog?.kind === 'delete'
                ? h(Modal, { title: t('deleteTitle'), onClose: () => setDialog(null) },
                  h('p', { className: css.dialogBody },
                    dialog.paths.length === 1 ? t('deleteConfirmOne', { name: dialog.names[0] }) : t('deleteConfirmMany', { count: dialog.paths.length })),
                  h('p', { className: css.dialogBody }, t('deleteFolderNote')),
                  h('div', { className: css.dialogActions },
                    h('button', { type: 'button', className: css.button, onClick: () => setDialog(null) }, t('cancel')),
                    h('button', { type: 'button', className: `${css.button} ${css.buttonDanger}`, onClick: () => submitDelete(dialog.paths) }, t('delete')),
                  ))
                : null,
              dialog?.kind === 'chmod'
                ? h(Modal, { title: t('permissionsTitle', { name: dialog.entry.name }), onClose: () => setDialog(null) },
                  h(PermissionsForm, {
                    entry: dialog.entry,
                    t,
                    onSubmit: (mode) => submitChmod(dialog.entry, mode),
                    onCancel: () => setDialog(null),
                  }))
                : null,
              dialog?.kind === 'move'
                ? h(Modal, { title: t('moveTitle'), onClose: () => setDialog(null) },
                  h(MoveForm, {
                    names: dialog.names,
                    initialDest: dialog.dest,
                    quickDirs: [...new Set([
                      listing.value?.parent,
                      ...entries.filter(item => item.type === 'directory' && !dialog.paths.includes(item.path)).map(item => item.path),
                      ...roots,
                    ].filter(dir => typeof dir === 'string' && dir !== '' && !dialog.paths.includes(dir)))],
                    t,
                    onSubmit: (destDir) => submitMove(dialog.paths, destDir),
                    onCancel: () => setDialog(null),
                  }))
                : null,

              preview !== null
                ? overlay(h(PreviewDialog, { preview, onClose: () => setPreview(null), download, onSaveText: savePreviewText, t }))
                : null,
            )
          }

          /**
           * Formats a numeric POSIX mode into a 3- or 4-digit octal string.
           * @param mode - file mode bits.
           * @returns octal string such as '755' or '4755'.
           */
          function formatOctalMode(mode) {
            const masked = mode & 0o7777
            return masked > 0o777
              ? masked.toString(8).padStart(4, '0')
              : masked.toString(8).padStart(3, '0')
          }

          /**
           * Formats a numeric POSIX mode into a 9-character symbolic string (e.g. 'rwxr-xr-x').
           * @param mode - file mode bits.
           * @returns symbolic permission string.
           */
          function formatSymbolicMode(mode) {
            const masked = mode & 0o7777
            const triad = (rBit, wBit, xBit, specialBit, specialChar) => {
              const r = (masked & rBit) !== 0 ? 'r' : '-'
              const w = (masked & wBit) !== 0 ? 'w' : '-'
              const xSet = (masked & xBit) !== 0
              const sSet = (masked & specialBit) !== 0
              const x = sSet ? (xSet ? specialChar : specialChar.toUpperCase()) : (xSet ? 'x' : '-')
              return `${r}${w}${x}`
            }
            return triad(0o400, 0o200, 0o100, 0o4000, 's')
              + triad(0o040, 0o020, 0o010, 0o2000, 's')
              + triad(0o004, 0o002, 0o001, 0o1000, 't')
          }

          /**
           * Parses a 3- or 4-digit octal mode string from the permission dialog input.
           * @param raw - user input string.
           * @returns numeric mode in 0..0o7777, or null when invalid.
           */
          function parseOctalModeInput(raw) {
            const trimmed = raw.trim()
            if (!/^[0-7]{3,4}$/.test(trimmed)) return null
            const parsed = Number.parseInt(trimmed, 8)
            return parsed >= 0 && parsed <= 0o7777 ? parsed : null
          }

          /**
           * A single-field form used by the new-folder and rename dialogs.
           * @param props - labels, initial value, and submit/cancel handlers.
           * @returns the form element.
           */
          function NameForm({ label, placeholder, initial, submitLabel, cancelLabel, onSubmit, onCancel, unchanged }) {
            const [value, setValue] = useState(initial)
            return h('form', {
              onSubmit: (event) => {
                event.preventDefault()
                if (value.trim() !== '') onSubmit(value.trim())
              },
            },
            h('div', { className: css.field },
              h('label', null, label),
              h('input', {
                className: css.input, value, placeholder, autoComplete: 'off', spellCheck: false,
                onChange: (event) => { setValue(event.target.value) },
              })),
            h('div', { className: css.dialogActions },
              h('button', { type: 'button', className: css.button, onClick: onCancel }, cancelLabel),
              h('button', {
                type: 'submit',
                className: `${css.button} ${css.buttonPrimary}`,
                disabled: value.trim() === '' || (unchanged?.(value) ?? false),
              }, submitLabel),
            ))
          }

          /**
           * Form combining an r/w/x checkbox matrix, quick presets, and octal mode input.
           * @param props - target entry, localized strings, and submit/cancel handlers.
           * @returns the form element.
           */
          function PermissionsForm({ entry, t, onSubmit, onCancel }) {
            const permGroups = [
              { key: 'permOwner', bits: [0o400, 0o200, 0o100] },
              { key: 'permGroup', bits: [0o040, 0o020, 0o010] },
              { key: 'permOthers', bits: [0o004, 0o002, 0o001] },
            ]
            const permPresets = [
              { mode: 0o755, key: 'permPreset755' },
              { mode: 0o644, key: 'permPreset644' },
              { mode: 0o600, key: 'permPreset600' },
              { mode: 0o700, key: 'permPreset700' },
            ]
            const initialMode = typeof entry.mode === 'number'
              ? (entry.mode & 0o7777)
              : (entry.type === 'directory' ? 0o755 : 0o644)
            const [state, setState] = useState(() => ({
              mode: initialMode,
              text: formatOctalMode(initialMode),
            }))
            const validMode = parseOctalModeInput(state.text)
            const applyMode = (nextMode) => {
              const masked = nextMode & 0o7777
              setState({ mode: masked, text: formatOctalMode(masked) })
            }

            return h('form', {
              onSubmit: (event) => {
                event.preventDefault()
                if (validMode !== null) onSubmit(validMode)
              },
            },
            h('div', { className: css.field },
              h('label', null, t('permOctalLabel')),
              h('div', { className: css.permOctalRow },
                h('input', {
                  className: css.input,
                  value: state.text,
                  placeholder: '755',
                  autoComplete: 'off',
                  spellCheck: false,
                  'aria-label': t('permOctalLabel'),
                  onChange: (event) => {
                    const text = event.target.value
                    const parsed = parseOctalModeInput(text)
                    setState(prev => ({ mode: parsed ?? prev.mode, text }))
                  },
                }),
                h('span', { className: css.permPreview }, formatSymbolicMode(validMode ?? state.mode)),
              ),
              h('span', null, t('permOctalHint')),
            ),
            validMode === null ? h('p', { className: css.permError }, t('permInvalid')) : null,
            h('table', { className: css.permMatrix },
              h('thead', null,
                h('tr', null,
                  h('th', null, ''),
                  h('th', null, t('permRead')),
                  h('th', null, t('permWrite')),
                  h('th', null, t('permExec')),
                ),
              ),
              h('tbody', null,
                permGroups.map(group => h('tr', { key: group.key },
                  h('td', null, t(group.key)),
                  group.bits.map((bit, colIndex) => {
                    const colLabel = colIndex === 0 ? t('permRead') : colIndex === 1 ? t('permWrite') : t('permExec')
                    return h('td', { key: bit },
                      h('input', {
                        type: 'checkbox',
                        checked: (state.mode & bit) !== 0,
                        'aria-label': `${t(group.key)} ${colLabel}`,
                        onChange: () => applyMode(state.mode ^ bit),
                      }),
                    )
                  }),
                )),
              ),
            ),
            h('div', { className: css.permPresets },
              permPresets.map(preset => h('button', {
                key: preset.mode,
                type: 'button',
                className: css.button,
                onClick: () => applyMode(preset.mode),
              }, t(preset.key))),
            ),
            h('div', { className: css.dialogActions },
              h('button', { type: 'button', className: css.button, onClick: onCancel }, t('cancel')),
              h('button', {
                type: 'submit',
                className: `${css.button} ${css.buttonPrimary}`,
                disabled: validMode === null,
              }, t('save')),
            ))
          }

          /**
           * Form to pick or type a destination directory for moving selected entries.
           * @param props - selected entry names, initial destination, quick target chips, and handlers.
           * @returns the form element.
           */
          function MoveForm({ names, initialDest, quickDirs, t, onSubmit, onCancel }) {
            const [dest, setDest] = useState(initialDest)
            return h('form', {
              onSubmit: (event) => {
                event.preventDefault()
                if (dest.trim() !== '') onSubmit(dest.trim())
              },
            },
            h('p', { className: css.dialogBody },
              names.length === 1 ? t('moveOneNote', { name: names[0] }) : t('moveManyNote', { count: names.length })),
            h('div', { className: css.field },
              h('label', null, t('moveLabel')),
              h('input', {
                className: css.input,
                value: dest,
                placeholder: t('movePlaceholder'),
                autoComplete: 'off',
                spellCheck: false,
                onChange: (event) => { setDest(event.target.value) },
              })),
            quickDirs.length > 0
              ? h('div', { className: css.field },
                h('label', null, t('moveQuickTargets')),
                h('div', { className: css.moveTargets },
                  quickDirs.map(dir => h('button', {
                    key: dir,
                    type: 'button',
                    className: css.rootChip,
                    onClick: () => { setDest(dir) },
                  }, dir === '/' ? t('rootCrumb') : dir)),
                ))
              : null,
            h('div', { className: css.dialogActions },
              h('button', { type: 'button', className: css.button, onClick: onCancel }, t('cancel')),
              h('button', {
                type: 'submit',
                className: `${css.button} ${css.buttonPrimary}`,
                disabled: dest.trim() === '',
              }, t('move')),
            ))
          }

          /**
           * The inline file preview and text editor dialog.
           * @param props - the open preview, close handler, download/save handlers, and copy.
           * @returns the dialog element.
           */
          function PreviewDialog({ preview, onClose, download, onSaveText, t }) {
            const headingId = useId()
            const [editing, setEditing] = useState(false)
            const [draft, setDraft] = useState('')
            const [saving, setSaving] = useState(false)
            const [saveError, setSaveError] = useState('')

            useEffect(() => {
              setEditing(false)
              setSaveError('')
            }, [preview.path])

            const state = preview.state
            const canEditText = state.status === 'ready' && state.value.kind === 'text' && !state.value.truncated
            const unchanged = state.status === 'ready' && draft === (state.value.text ?? '')

            const handleSave = async () => {
              if (saving || unchanged || !canEditText) return
              setSaving(true)
              setSaveError('')
              try {
                await onSaveText(preview.path, draft)
                setEditing(false)
              } catch (error) {
                setSaveError(String(error.message ?? error))
              } finally {
                setSaving(false)
              }
            }

            return h('div', {
              className: css.previewBackdrop, role: 'presentation',
              onMouseDown: (event) => {
                if (event.target !== event.currentTarget) return
                // Avoid accidental dismissal when selecting text or editing a file.
                if (editing || window.getSelection()?.toString()) return
                onClose()
              },
            },
            h('div', { className: css.preview, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': headingId },
              h('div', { className: css.previewHead },
                h('h2', { id: headingId, className: css.previewTitle }, preview.name),
                h('div', { className: css.links },
                  editing
                    ? h(React.Fragment, null,
                      h('button', {
                        type: 'button',
                        className: `${css.button} ${css.buttonPrimary}`,
                        disabled: saving || unchanged,
                        onClick: () => { void handleSave() },
                      }, t('save')),
                      h('button', {
                        type: 'button',
                        className: css.button,
                        disabled: saving,
                        onClick: () => { setEditing(false); setSaveError('') },
                      }, t('cancel')),
                    )
                    : canEditText
                      ? h('button', {
                        type: 'button',
                        className: css.button,
                        onClick: () => { setDraft(state.value.text ?? ''); setSaveError(''); setEditing(true) },
                      }, t('editFile'))
                      : null,
                  h('a', {
                    className: css.button,
                    href: `api/file-manager.raw?path=${encodeURIComponent(preview.path)}`,
                    target: '_blank',
                    rel: 'noopener',
                  }, t('openInBrowser')),
                  h('button', { type: 'button', className: css.button, onClick: () => { download(preview.path) } }, t('downloadFile')),
                  h('button', { type: 'button', className: `${css.button} ${css.buttonIcon}`, onClick: onClose, 'aria-label': t('close') }, glyph('close')),
                ),
              ),
              saveError !== '' ? h('p', { className: css.editorNote, role: 'alert' }, saveError) : null,
              state.status === 'ready' && state.value.kind === 'text' && state.value.truncated
                ? h('p', { className: css.editorNote }, t('editTruncated'))
                : null,
              h('div', { className: css.previewBody },
                state.status === 'loading' ? h('p', { className: css.status, role: 'status' }, t('loading')) : null,
                state.status === 'error' ? h('p', { className: `${css.status} ${css.noticeError}`, role: 'alert' }, `${t('previewFailed')} ${state.error}`) : null,
                state.status === 'ready' && state.value.kind === 'text'
                  ? (editing
                    ? h('textarea', {
                      className: css.editorArea,
                      value: draft,
                      spellCheck: false,
                      'aria-label': preview.name,
                      onChange: (event) => { setDraft(event.target.value) },
                    })
                    : h('pre', { className: css.previewText }, `${state.value.text ?? ''}${state.value.truncated ? `\n\n… ${t('previewTruncated')}` : ''}`))
                  : null,
                state.status === 'ready' && state.value.kind === 'image'
                  ? h('img', { className: css.previewImage, src: state.url, alt: preview.name })
                  : null,
                state.status === 'ready' && state.value.kind === 'pdf'
                  ? h('iframe', { className: css.previewFrame, src: state.url, title: preview.name })
                  : null,
                state.status === 'ready' && state.value.kind === 'binary'
                  ? h('p', { className: css.status }, t('previewBinary'))
                  : null,
              ),
            ))
          }

          return FileManagerPage
        }
      return { createPageComponent: createPageComponent }
    })()

    return {
      inject: ['slots', 'locale', 'remote'],
      async apply(ctx) {
        try {
          return await start(ctx)
        } catch (error) {
          // One thrown activation hides the whole feature, including the sidebar
          // row, so the failure is named in the console before it propagates.
          console.error('[file-manager] client activation failed:', error)
          throw error
        }
      },
    }

    /**
     * Mount the Remote contribution, register the copy, and contribute the
     * sidebar row and the page.
     * @param ctx - browser plugin context.
     * @returns the disposer that unmounts the Remote contribution.
     */
    async function start(ctx) {
      const React = require('react')
      const zod = require('zod')
      const { page, contract, locale, icon } = modules()

      // Mount the contribution in the plugin's own fiber, so unloading the
      // plugin takes the `remote.fileManager` namespace with it.
      const unmount = await ctx.remote.$mount(contract.clientContribution(zod))
      // The mounted namespace is handed to the page through the slot's inject
      // face: a `main` component receives the standard hooks, never `remote`.
      // It is read with ctx.get(), not ctx.remote.fileManager: Cordis refuses a
      // property read for a service the fiber did not declare in `inject`, and
      // this namespace cannot be declared there because this plugin creates it.
      const fileManager = ctx.get('remote.fileManager')
        ?? ctx.reflect?.get?.('remote.fileManager', false)
      if (fileManager === undefined) throw new Error('fileManager namespace did not mount')

      const disposeLocale = ctx.locale.register('fileManager', { en: locale.en, zh: locale.zh })
      const t = ctx.locale.bind('fileManager')
      const h = React.createElement
      const Page = page.createPageComponent({ React, ReactDOM: require('react-dom') })

      /**
       * The left-sidebar glyph; the sidebar owns the button, label, and state.
       * @param props - requested square edge.
       * @returns the icon element.
       */
      const panelIcon = ({ size }) => h('svg', {
        viewBox: icon.ICON_VIEWBOX,
        width: size,
        height: size,
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block' },
      }, icon.ICON_PATHS.map((shape, index) => h('path', { key: index, ...shape })))

      ctx.effect(() => [
        disposeLocale,
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'file-manager',
          order: 20,
          label: () => t('panel'),
          locale: 'fileManager',
        }, panelIcon)),
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'file-manager',
          locale: 'fileManager',
          inject: () => ({ fileManager }),
        }, Page)),
      ], 'file-manager: client contributions')

      return () => unmount()
    }
  },
})