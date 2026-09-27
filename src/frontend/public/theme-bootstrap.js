/**
 * Restore the saved theme before the first paint, so there is no flash.
 *
 * Loaded with `<script src>` rather than inlined because the app ships a
 * Content-Security-Policy that omits `'unsafe-inline'` for scripts: an inline
 * block would need either that exemption or a hash that has to be recomputed
 * whenever this file changes. A separate file costs one small cached request and
 * buys a policy with no script exemption in it at all.
 */
(function () {
  try {
    var theme = localStorage.getItem("studyforge-theme");
    var root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else if (theme === "frosted") {
      root.classList.add("frosted");
      root.style.colorScheme = "light";
    } else {
      root.style.colorScheme = "light";
    }
  } catch (e) {
    /* localStorage unavailable — fall back to the light theme */
  }
})();
