/* ----------------- Utilitaires ----------------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* ----------------- Thème clair/sombre ----------------- */
const root = document.documentElement;
const saved = localStorage.getItem("theme");
if (saved) root.setAttribute("data-theme", saved);
$("#themeToggle")?.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "light" ? "" : "light";
  if (next) root.setAttribute("data-theme", next);
  else root.removeAttribute("data-theme");
  localStorage.setItem("theme", next);
});

/* ----------------- Année dynamique ----------------- */
$("#year").textContent = new Date().getFullYear();

/* ----------------- Révélation au scroll ----------------- */
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("in"); });
}, { threshold: 0.14 });
$$(".reveal").forEach(el => io.observe(el));

/* ----------------- Parallaxe légère sur le hero ----------------- */
const hero = $(".hero");
const blobs = $$(".blob");
if (hero && blobs.length){
  hero.addEventListener("mousemove", (e) => {
    const r = hero.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    blobs[0].style.transform = `translate(${x * 12}px, ${y * 8}px) scale(1)`;
    blobs[1].style.transform = `translate(${x * -10}px, ${y * -6}px) scale(1)`;
  });
}

/* ----------------- Effet « ripple » léger sur les boutons ----------------- */
$$(".btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    const rect = btn.getBoundingClientRect();
    const d = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = `${d}px`;
    ripple.style.left = `${e.clientX - rect.left - d/2}px`;
    ripple.style.top = `${e.clientY - rect.top - d/2}px`;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});
