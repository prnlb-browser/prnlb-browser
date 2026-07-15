// --- Image Carousel ---

let carouselImages = [];
let carouselIndex = 0;

const modalOverlay = document.getElementById("image-modal");
const modalTitle = document.getElementById("modal-title");
const modalClose = document.getElementById("carousel-close");
const carouselImg = document.getElementById("carousel-image");
const carouselLoading = document.getElementById("carousel-loading");
const carouselPrev = document.getElementById("carousel-prev");
const carouselNext = document.getElementById("carousel-next");
const carouselCounter = document.getElementById("carousel-counter");
const carouselThumbnails = document.getElementById("carousel-thumbnails");

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
  modalOverlay.hidden = true;
  carouselImages = [];
  carouselIndex = 0;
}

async function openImageCarousel(topicUrl, title) {
  modalOverlay.hidden = false;
  modalTitle.textContent = `📷 ${title}`;
  carouselImg.src = "";
  carouselImg.style.display = "none";
  carouselLoading.hidden = false;
  carouselThumbnails.innerHTML = "";
  carouselCounter.textContent = "";
  carouselPrev.disabled = true;
  carouselNext.disabled = true;

  const progressText = document.getElementById("carousel-progress-text");
  const progressBarContainer = document.getElementById("carousel-progress-bar-container");
  const progressBar = document.getElementById("carousel-progress-bar");
  progressText.textContent = "Scraping topic images...";
  progressBar.style.width = "0%";
  progressBarContainer.hidden = true;

  function processLines(text) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = JSON.parse(line.slice(6));

      if (data.phase === "scraping") {
        progressText.textContent = data.message;
        progressBarContainer.hidden = true;
      } else if (data.phase === "resolving") {
        progressText.textContent = data.message;
        progressBarContainer.hidden = false;
        const pct = Math.round((data.current / data.total) * 100);
        progressBar.style.width = pct + "%";
      } else if (data.phase === "done") {
        if (!data.images || data.images.length === 0) {
          progressText.textContent = "No images found from supported hosts.";
          progressBarContainer.hidden = true;
          return true;
        }
        carouselImages = data.images;
        renderCarouselThumbnails();
        showCarouselImage(0);
        carouselLoading.hidden = true;
        return true;
      } else if (data.phase === "error") {
        progressText.textContent = `Error: ${data.message}`;
        progressBarContainer.hidden = true;
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
    progressText.textContent = `Error: ${err.message}`;
  }
}

function renderCarouselThumbnails() {
  carouselThumbnails.innerHTML = "";
  carouselImages.forEach((img, i) => {
    const thumb = document.createElement("img");
    thumb.className = "carousel-thumb" + (i === 0 ? " active" : "");
    // Use thumbnailUrl (the <img src> from the post) for carousel thumbnails
    thumb.src = img.thumbnailUrl || img.originalUrl;
    thumb.alt = `Thumb ${i + 1}`;
    thumb.loading = "lazy";
    thumb.addEventListener("click", () => showCarouselImage(i));
    carouselThumbnails.appendChild(thumb);
  });
}

function showCarouselImage(index) {
  if (carouselImages.length === 0) return;

  // Clamp index
  index = Math.max(0, Math.min(index, carouselImages.length - 1));
  carouselIndex = index;

  const img = carouselImages[index];
  carouselImg.src = img.resolvedUrl;
  carouselImg.style.display = "block";
  carouselLoading.hidden = true;

  // Update counter
  carouselCounter.textContent = `${index + 1} / ${carouselImages.length}`;

  // Update buttons
  carouselPrev.disabled = index === 0;
  carouselNext.disabled = index === carouselImages.length - 1;

  // Update active thumbnail
  const thumbs = carouselThumbnails.querySelectorAll(".carousel-thumb");
  thumbs.forEach((t, i) => {
    t.classList.toggle("active", i === index);
    if (i === index) {
      t.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  });
}

