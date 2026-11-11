try {
  var query = new URLSearchParams(location.search).get("theme");
  var stored = query === "dark" || query === "light" ? query : localStorage.getItem("seedix-theme");
  if (stored === "dark" || stored === "light") document.documentElement.dataset.theme = stored;
} catch (err) {
  /* the theme toggle still works after paint */
}
