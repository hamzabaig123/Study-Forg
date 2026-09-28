/**
 * The closing chrome for every shell — signed-in, public, and the landing page.
 *
 * Two lines with a deliberate gap: the platform's copyright, then the author
 * credit. The name is not decoration markup — it is the only place the app
 * states who built it, so it carries the brand gradient rather than plain ink.
 */
export function AppFooter() {
  return (
    <footer
      data-ocid="app.footer"
      className="pb-safe border-t border-border bg-card px-4 py-6 sm:px-6"
    >
      <div className="flex flex-col items-center gap-3">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} StudyForge
        </p>
        <p className="text-center text-xs text-muted-foreground">
          Made by{" "}
          <span className="credit-name font-display text-foreground font-medium italic">
            Mirza Muhammad Hamza Baig
          </span>
        </p>
      </div>
    </footer>
  );
}
