/**
 * The closing chrome for every shell — signed-in, public, and the landing page.
 *
 * Sits directly on the page background rather than a card, so each theme's
 * canvas is what shows through and the footer visibly re-tints on a switch.
 * The author's name is the one accent-coloured element (measured ≥ 4.86:1 as
 * text in every theme), in the display serif with a solid accent rule that
 * draws in from the left and runs slightly past the name.
 */
export function AppFooter() {
  return (
    <footer
      data-ocid="app.footer"
      className="pb-safe border-t border-border px-4 py-8 sm:px-6"
    >
      <div className="flex flex-col items-center gap-2.5">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} StudyForge
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Made by{" "}
          <span className="credit-name font-display text-accent font-bold italic">
            Mirza Muhammad Hamza Baig
          </span>
        </p>
      </div>
    </footer>
  );
}
