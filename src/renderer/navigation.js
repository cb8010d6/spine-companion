export function createNavigationGuard() {
  let revision = 0;
  return {
    begin(view) {
      return { revision: ++revision, view };
    },
    isCurrent(token, activeView) {
      return token.revision === revision && token.view === activeView;
    }
  };
}
