<script setup lang="ts">
</script>

<template>
  <div class="tni-app">
    <header class="tni-topbar">
      <span class="tni-brand">Tower Networking Inc</span>
      <span class="tni-status">Phase 0 scaffold</span>
    </header>
    <main class="tni-main">
      <p class="tni-placeholder">
        Graph view will render here. Press
        <kbd>`</kbd> to open the command palette (not yet implemented).
      </p>
    </main>
  </div>
</template>

<style scoped>
.tni-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--tni-bg);
  color: var(--tni-fg);
  font-family: var(--tni-font-ui);
}
.tni-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--tni-border);
  background: var(--tni-bg-elevated);
}
.tni-brand {
  font-weight: 600;
  letter-spacing: 0.02em;
}
.tni-status {
  font-family: var(--tni-font-mono);
  color: var(--tni-fg-muted);
  font-size: 0.85rem;
}
.tni-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}
.tni-placeholder {
  color: var(--tni-fg-muted);
  text-align: center;
  max-width: 40ch;
  line-height: 1.5;
}
kbd {
  background: var(--tni-bg-elevated);
  border: 1px solid var(--tni-border);
  border-radius: 4px;
  padding: 0 0.35em;
  font-family: var(--tni-font-mono);
  font-size: 0.9em;
}
</style>
