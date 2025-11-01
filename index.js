<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>IG Grid</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <div id="app" class="wrap">
    <div class="toolbar" role="region" aria-label="Toolbar">
      <div class="toolbar__left">
        <button id="btnRefresh" class="btn btn--refresh" aria-label="Refresh">
          <span class="ico-refresh" aria-hidden="true"></span> Refresh
        </button>
        <button id="btnClear" class="btn btn--ghost" aria-label="Clear filters" disabled>
          Clear filters <span id="badgeCount" class="badge" hidden>0</span>
        </button>
      </div>

      <div class="filters" id="filters">
        <!-- Clients -->
        <div class="select" data-key="clients">
          <button class="select__btn" id="fClient" aria-haspopup="listbox" aria-expanded="false">All Clients</button>
          <div class="select__menu" id="mClient" role="listbox" aria-label="Clients"></div>
        </div>

        <!-- Projects -->
        <div class="select" data-key="projects">
          <button class="select__btn" id="fProject" aria-haspopup="listbox" aria-expanded="false">All Projects</button>
          <div class="select__menu" id="mProject" role="listbox" aria-label="Projects"></div>
        </div>

        <!-- Platforms -->
        <div class="select" data-key="platforms">
          <button class="select__btn" id="fPlatform" aria-haspopup="listbox" aria-expanded="false">All Platforms</button>
          <div class="select__menu" id="mPlatform" role="listbox" aria-label="Platforms"></div>
        </div>

        <!-- Owners -->
        <div class="select" data-key="owners">
          <button class="select__btn" id="fOwner" aria-haspopup="listbox" aria-expanded="false" title="All Owners">All Owners</button>
          <div class="select__menu" id="mOwner" role="listbox" aria-label="Owners"></div>
        </div>

        <!-- Status (single-select) -->
        <div class="select select--single" data-key="statuses">
          <button class="select__btn" id="fStatus" aria-haspopup="listbox" aria-expanded="false">All Status</button>
          <div class="select__menu" id="mStatus" role="listbox" aria-label="Status"></div>
        </div>
      </div>
    </div>

    <!-- Loading overlay -->
    <div id="overlay" class="overlay" hidden>
      <div class="spinner" aria-hidden="true"></div>
    </div>

    <!-- Grid -->
    <div id="grid" class="grid" aria-live="polite"></div>

    <!-- Load more -->
    <div class="more">
      <button id="btnMore" class="btn btn--more">Load more</button>
    </div>
  </div>

  <!-- Toasts -->
  <div id="toasts" class="toasts" aria-live="assertive" aria-atomic="true"></div>

  <!-- Modal -->
  <div id="modal" class="modal" aria-hidden="true">
    <div class="modal__backdrop" id="modalBackdrop"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-label="Post viewer">
      <button class="modal__close" id="modalClose" aria-label="Close">✕</button>

      <div class="viewer">
        <div class="viewer__stage" id="vStage" tabindex="0"></div>

        <div class="viewer__nav">
          <button class="nav prev" id="vPrev" aria-label="Previous">‹</button>
          <div class="viewer__dots" id="vDots"></div>
          <button class="nav next" id="vNext" aria-label="Next">›</button>
        </div>

        <div class="viewer__copy" id="vCopy" hidden></div>
      </div>
    </div>
  </div>

  <script type="module" src="./index.js"></script>
</body>
</html>
