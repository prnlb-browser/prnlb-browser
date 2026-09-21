// --- Image Carousel ---

let carouselImages = [];
let carouselIndex = 0;
let carouselRequestController = null;

const modalOverlay = document.getElementById("image-modal");
const modalTitle = document.getElementById("modal-title");
const modalClose = document.getElementById("carousel-close");
const carouselImg = document.getElementById("carousel-image");
const carouselLoading = document.getElementById("carousel-loading");
const carouselPrev = document.getElementById("carousel-prev");
const carouselNext = document.getElementById("carousel-next");
const carouselCounter = document.getElementById("carousel-counter");
const carouselThumbnails = document.getElementById("carousel-thumbnails");
const carouselResolutionStatus = document.getElementById("carousel-resolution-status");

modalClose.addEventListener("click", closeCarousel);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeCarousel();
});
document.addEventListener("keydown", (e) => {
  if (!modalOverlay || modalOverlay.hidden) return;
  if (e.key === "Escape") closeCarousel();
  if (e.key === "ArrowLeft") showCarouselImage(carouselIndex - 1);
  if (e.key === "ArrowRight") showCarouselImage(carouselIndex + 1);
});
carouselPrev.addEventListener("click", () => showCarouselImage(carouselIndex - 1));
carouselNext.addEventListener("click", () => showCarouselImage(carouselIndex + 1));
carouselImg.addEventListener("click", () => {
  if (carouselImages[carouselIndex]?.resolvedUrl) {
    window.open(carouselImages[carouselIndex].resolvedUrl, "_blank");
  }
});

function closeCarousel() {
  carouselRequestController?.abort();
  carouselRequestController = null;
  modalOverlay.hidden = true;
  carouselImages = [];
  carouselIndex = 0;
}

async function openImageCarousel(topicUrl, title) {
  carouselRequestController?.abort();
  const requestController = new AbortController();
  carouselRequestController = requestController;

  modalOverlay.hidden = false;
  modalTitle.textContent = `📷 ${title}`;
  carouselImg.src = "";
  carouselImg.style.display = "none";
  carouselLoading.hidden = false;
  carouselThumbnails.innerHTML = "";
  carouselCounter.textContent = "";
  carouselResolutionStatus.textContent = "⏳ Scraping topic images...";
  carouselResolutionStatus.classList.add("active");
  carouselPrev.disabled = true;
  carouselNext.disabled = true;

  function processLines(text) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = JSON.parse(line.slice(6));

      if (data.phase === "scraping") {
        carouselResolutionStatus.textContent = `⏳ ${data.message}`;
      } else if (data.phase === "resolving") {
        const current = Number(data.current) || 0;
        const total = Number(data.total) || 0;
        carouselResolutionStatus.textContent = `⏳ ${current}/${total} resolved`;
        carouselResolutionStatus.classList.add("active");
        if (data.image) appendCarouselImage(data.image);
      } else if (data.phase === "done") {
        for (const image of data.images || []) appendCarouselImage(image);
        if (carouselImages.length === 0) {
          carouselResolutionStatus.textContent = t("No images found from supported hosts.");
          carouselResolutionStatus.classList.remove("active");
          carouselLoading.hidden = true;
          return true;
        }
        carouselLoading.hidden = true;
        carouselResolutionStatus.textContent = `✓ ${carouselImages.length}/${data.total || carouselImages.length} resolved`;
        carouselResolutionStatus.classList.remove("active");
        return true;
      } else if (data.phase === "error") {
        carouselResolutionStatus.textContent = `⚠ ${data.message}`;
        carouselResolutionStatus.classList.remove("active");
        carouselLoading.hidden = true;
        return true;
      }
    }
    return false;
  }

  try {
    const res = await fetch("/api/topic/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicUrl }),
      signal: requestController.signal,
    });

    // Stream SSE events from the response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Process any remaining data left in the buffer
        if (buffer.trim()) processLines(buffer);
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines, keep incomplete last line in buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      if (processLines(lines.join("\n"))) return;
    }
  } catch (err) {
    if (err.name !== "AbortError" && !modalOverlay.hidden) {
      carouselResolutionStatus.textContent = `⚠ ${err.message}`;
      carouselResolutionStatus.classList.remove("active");
      carouselLoading.hidden = true;
    }
  } finally {
    if (carouselRequestController === requestController) {
      carouselRequestController = null;
    }
  }
}

function renderCarouselThumbnails() {
  carouselThumbnails.innerHTML = "";
  carouselImages.forEach((img, i) => {
    const thumb = document.createElement("img");
    thumb.className = "carousel-thumb" + (i === carouselIndex ? " active" : "");
    // Use thumbnailUrl (the <img src> from the post) for carousel thumbnails
    thumb.src = img.thumbnailUrl || img.originalUrl;
    thumb.alt = `Thumb ${i + 1}`;
    thumb.loading = "lazy";
    thumb.addEventListener("click", () => showCarouselImage(i));
    carouselThumbnails.appendChild(thumb);
  });
}

function appendCarouselImage(image) {
  if (!image?.resolvedUrl) return;
  if (carouselImages.some((existing) => existing.originalUrl === image.originalUrl)) return;

  const wasEmpty = carouselImages.length === 0;
  carouselImages.push(image);
  renderCarouselThumbnails();

  if (wasEmpty) {
    showCarouselImage(0);
    return;
  }

  updateCarouselNavigation();
}

function updateCarouselNavigation() {
  if (carouselImages.length === 0) {
    carouselCounter.textContent = "";
    carouselPrev.disabled = true;
    carouselNext.disabled = true;
    return;
  }

  carouselCounter.textContent = `${carouselIndex + 1} / ${carouselImages.length}`;
  carouselPrev.disabled = carouselIndex === 0;
  carouselNext.disabled = carouselIndex === carouselImages.length - 1;

  const thumbs = carouselThumbnails.querySelectorAll(".carousel-thumb");
  thumbs.forEach((thumb, i) => {
    thumb.classList.toggle("active", i === carouselIndex);
  });
}

function showCarouselImage(index) {
  if (carouselImages.length === 0) return;

  // Clamp index
  index = Math.max(0, Math.min(index, carouselImages.length - 1));
  carouselIndex = index;

  const img = carouselImages[index];
  carouselImg.src = `/api/topic/image?url=${encodeURIComponent(img.resolvedUrl)}`;
  carouselImg.style.display = "block";
  carouselLoading.hidden = true;

  updateCarouselNavigation();
  carouselThumbnails.querySelectorAll(".carousel-thumb")[index]?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "center",
  });
}
