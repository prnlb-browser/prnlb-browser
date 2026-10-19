const library = document.getElementById("library");
const status = document.getElementById("status");
const search = document.getElementById("search");
const actressFilter = document.getElementById("actress");
const tagFilter = document.getElementById("tags");
const sortBy = document.getElementById("sort-by");
const sortDir = document.getElementById("sort-dir");
const player = document.getElementById("player");
const video = player.querySelector("video");
let searchTimer;

function render(items) {
  library.replaceChildren();
  status.textContent = `${items.length} file(s)`;
  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = "No files match these filters.";
    library.append(empty);
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    if (item.hasImage) {
      const image = document.createElement("img");
      image.src = `/items/${item.id}/image`;
      image.alt = "";
      image.loading = "lazy";
      card.append(image);
    }
    const title = document.createElement("h2");
    title.textContent = item.title || item.fileName;
    const detail = document.createElement("p");
    detail.textContent = [item.starring, item.duration, ...(item.tags || []).map(tag => tag.name)].filter(Boolean).join(" · ");
    const play = document.createElement("button");
    play.textContent = "Play";
    play.addEventListener("click", () => {
      document.getElementById("playing").textContent = item.title || item.fileName;
      video.src = `/items/${item.id}/file`;
      player.showModal();
      video.play().catch(() => {});
    });
    const download = document.createElement("a");
    download.href = `/items/${item.id}/file?download=1`;
    download.textContent = "Download";
    card.append(title, detail, play, download);
    library.append(card);
  }
}

async function loadItems() {
  const params = new URLSearchParams();
  const query = search.value.trim();
  if (query) params.set("q", query);
  if (actressFilter.value) params.set("actress", actressFilter.value);
  const tags = Array.from(tagFilter.selectedOptions).map(option => option.value).filter(Boolean);
  if (tags.length) params.set("tags", tags.join(","));
  params.set("sortBy", sortBy.value);
  params.set("sortDir", sortDir.value);
  status.textContent = "Loading…";
  try {
    const response = await fetch(`/library?${params}`);
    if (!response.ok) throw new Error("Could not load the library.");
    render(await response.json());
  } catch (error) {
    status.textContent = error.message;
  }
}

async function loadFilters() {
  const response = await fetch("/filters");
  if (!response.ok) throw new Error("Could not load library filters.");
  const filters = await response.json();
  for (const actress of filters.actresses || []) {
    const option = document.createElement("option");
    option.value = String(actress.id);
    option.textContent = actress.name;
    actressFilter.append(option);
  }
  for (const tag of filters.tags || []) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    tagFilter.append(option);
  }
}

search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadItems, 180);
});
for (const control of [actressFilter, tagFilter, sortBy, sortDir]) control.addEventListener("change", loadItems);
document.getElementById("close").addEventListener("click", () => { video.pause(); player.close(); });
player.addEventListener("close", () => { video.pause(); video.removeAttribute("src"); video.load(); });

loadFilters().then(loadItems).catch(error => { status.textContent = error.message; });
