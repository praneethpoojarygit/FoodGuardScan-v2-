// ---------------- GLOBAL ELEMENTS ----------------
const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const scanBtn = document.getElementById("scanBtn");
const scanResult = document.getElementById("scanResult");
const aiAnalysis = document.getElementById("aiAnalysis");

const cameraBtn = document.getElementById("cameraBtn");
const camera = document.getElementById("camera");
const captureBtn = document.getElementById("captureBtn");

const loadingOverlay = document.getElementById("loadingOverlay");
const historyList = document.getElementById("historyList");

const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const step3 = document.getElementById("step3");

const searchIngredient = document.getElementById("searchIngredient");
const filterRisk = document.getElementById("filterRisk");

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");

let capturedImageBlob = null;
let ingredientCards = [];
let scanHistory = JSON.parse(localStorage.getItem("scanHistory") || "[]");
let capturedImageDataUrl = null;
let currentIngredients = []; // for chat context

// ---------------- Sidebar ----------------
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

// ---------------- USER PROFILE ----------------
window.addEventListener("DOMContentLoaded", () => {
  const userName = localStorage.getItem("userName") || "User";
  const userPic = localStorage.getItem("userPicture") || "";

  document.getElementById("welcomeName").textContent = `Hello, ${userName}!`;
  if (userPic) {
    const profilePic = document.getElementById("profilePic");
    profilePic.src = userPic;
    profilePic.style.display = "inline-block";
  }

  renderHistory();
});

// ---------------- Logout ----------------
function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

// ---------------- Local Knowledge DB ----------------
const localDB = {
  "sugar": "High sugar can worsen diabetes and increase obesity risk.",
  "salt": "Excess salt increases blood pressure.",
  "sodium nitrate": "Used in processed meats; linked to heart problems.",
  "msg": "Flavor enhancer; some may get headaches.",
  "aspartame": "Artificial sweetener; avoid in PKU and limit for diabetics.",
  "trans fat": "Increases bad cholesterol and heart disease risk.",
  "fiber": "Good for digestion and heart health.",
  "vitamin": "Generally beneficial for body function."
};

// ---------------- File Upload ----------------
if (imageInput) {
  imageInput.addEventListener("change", function(event) {
    const file = event.target.files[0];
    if (file) {
      capturedImageBlob = file; // For upload
      const reader = new FileReader();
      reader.onload = function(e) {
        preview.src = e.target.result;
        capturedImageDataUrl = e.target.result; // For history
        preview.style.display = "block";
        activateStep(1);
      }
      reader.readAsDataURL(file);
    }
  });
}

// ---------------- Camera Access ----------------
if (cameraBtn) {
  cameraBtn.addEventListener("click", async function() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      camera.srcObject = stream;
      camera.style.display = "block";
      captureBtn.style.display = "block";
    } catch (err) {
      console.error("Camera access denied or not available.", err);
    }
  });
}

// ---------------- Capture from Webcam ----------------
if (captureBtn) {
  captureBtn.addEventListener("click", function() {
    const canvas = document.createElement("canvas");
    canvas.width = camera.videoWidth;
    canvas.height = camera.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(camera, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
      capturedImageBlob = blob;
    }, 'image/jpeg');

    capturedImageDataUrl = canvas.toDataURL('image/jpeg');
    preview.src = capturedImageDataUrl; // Use data URL directly
    preview.style.display = "block";
    activateStep(1);

    // Stop camera stream
    const stream = camera.srcObject;
    const tracks = stream.getTracks();
    tracks.forEach(track => track.stop());
    camera.srcObject = null;
  });
}

// ---------------- Step Indicator ----------------
function activateStep(step) {
  [step1, step2, step3].forEach((el, idx) => {
    el.classList.toggle("active", idx <= step);
  });
}

// ---------------- Ingredient Risk via OpenFoodFacts (Parallel) ----------------
async function getIngredientRiskOFF(ingredients) {
  const promises = ingredients.map(async (ing) => {
    try {
      const response = await fetch(`https://world.openfoodfacts.org/ingredient/${encodeURIComponent(ing)}.json`);
      const data = await response.json();

      let status = "moderate"; // default

      if (data && data.products && data.products.length > 0) {
        const product = data.products[0];

        // Nutriscore
        if (product.nutriscore_grade) {
          if (["a", "b"].includes(product.nutriscore_grade)) status = "good";
          else if (["d", "e"].includes(product.nutriscore_grade)) status = "bad";
        }

        // NOVA group
        if (product.nova_group && product.nova_group >= 4) status = "bad";

        // Additives
        if (product.additives_tags && product.additives_tags.length > 0) {
          if (product.additives_tags.some(tag =>
            tag.includes("e950") || tag.includes("e951") || tag.includes("e621")
          )) status = "bad";
        }
      }

      return { ingredient: ing, status };
    } catch (err) {
      console.error("OFF lookup error for", ing, err);
      return { ingredient: ing, status: "moderate" };
    }
  });

  return await Promise.all(promises);
}

// ---------------- OCR + Personalized Analysis ----------------
if (scanBtn) {
  scanBtn.addEventListener("click", async function() {
    if (!capturedImageBlob && !capturedImageDataUrl) {
      console.error("Please select or capture an image first!");
      return;
    }

    loadingOverlay.style.display = "flex";
    activateStep(2);

    const userName = localStorage.getItem("userName") || "User";
    const userHealth = localStorage.getItem("userHealth") || "general health";

    scanResult.style.display = "block";
    scanResult.innerHTML = `<b>${userName}</b>, analyzing ingredients for your health condition: <i>${userHealth}</i>...`;
    aiAnalysis.innerHTML = "";

    let text = "";

    try {
      // -------- Try OCR.space API first --------
      const formData = new FormData();
      formData.append("apikey", "K88649535188957"); // ⚠️ move to backend later
      formData.append("language", "eng");
      formData.append("isOverlayRequired", "false");
      formData.append("file", capturedImageBlob);

      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        body: formData
      });

      const data = await response.json();
      console.log("OCR.space result:", data);

      if (data.ParsedResults && data.ParsedResults.length > 0 && data.ParsedResults[0].ParsedText) {
        text = data.ParsedResults[0].ParsedText;
      } else {
        throw new Error("OCR.space returned no text");
      }
    } catch (error) {
      console.warn("⚠️ OCR.space failed, using Tesseract.js fallback...", error);

      try {
        // -------- Tesseract.js Fallback --------
        scanResult.innerHTML += "<br><br>⚡ Using offline OCR fallback...";

        const tesseractResult = await Tesseract.recognize(
          capturedImageDataUrl || capturedImageBlob,
          'eng',
          {
            logger: m => {
              if (m.status === 'recognizing text') {
                scanResult.innerHTML = `<br><br>⚡ Tesseract OCR Progress: ${Math.round(m.progress * 100)}%`;
              }
            }
          }
        );
        text = tesseractResult.data.text;
        console.log("Tesseract result:", text);
      } catch (tessError) {
        console.error("Tesseract also failed:", tessError);
        scanResult.innerHTML += "<br><br>❌ OCR failed. Please try again.";
        loadingOverlay.style.display = "none";
        return;
      }
    }

    // -------- Process Extracted Text --------
    text = text.replace(/ingredients?:/i, ""); // clean
    scanResult.innerHTML += `<br><br><b>Extracted Ingredients:</b><br>${text}`;
    currentIngredients = text.split(/,|\n/).map(i => i.trim().replace(/\.$/, '')).filter(i => i.length > 0);

    ingredientCards = [];
    aiAnalysis.innerHTML = "";

    const aiResults = await getIngredientRiskOFF(currentIngredients);

    aiResults.forEach(item => {
      const card = document.createElement("div");
      card.className = `ingredient-card ${item.status}`;
      card.innerHTML = `${item.ingredient}<div class="tooltip">${localDB[item.ingredient.toLowerCase()] || "Click for details"}</div>`;
      card.dataset.risk = item.status;
      card.onclick = () => sendChat(`Tell me about ${item.ingredient}`);
      aiAnalysis.appendChild(card);
      ingredientCards.push(card);
    });

    saveToHistory(capturedImageDataUrl, currentIngredients.slice(0,5).join(", "));
    activateStep(3);

    loadingOverlay.style.display = "none";
  });
}

// ---------------- Chat ----------------
function addChatMessage(msg, type) {
  const div = document.createElement("div");
  div.className = `chat-message ${type}`;
  div.textContent = msg;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChat(msg = null) {
  const text = msg || chatInput.value.trim();
  if (!text) return;

  addChatMessage(text, "user");
  chatInput.value = "";

  const userHealth = localStorage.getItem("userHealth") || "general health";
  const prompt = `You are FoodGuard AI. Only answer questions about the scanned food and ingredients. User health: ${userHealth}. 
Scanned ingredients: ${currentIngredients.join(", ")}. 
User asked: "${text}".`;

  try {
    const GEMINI_API_KEY = "AIzaSyDhvkj_IX818OhXRdngUCs1-SCOvPuepLc";
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    console.log(data);

    let reply = "No specific info available.";
    if (data?.candidates?.length > 0 && data.candidates[0]?.content?.parts?.length > 0) {
      reply = data.candidates[0].content.parts[0].text;
    } else if (data.error) {
      reply = `⚠️ AI Error: ${data.error.message}`;
      console.error("Gemini API Error:", data.error);
    }

    addChatMessage(reply, "ai");
  } catch (err) {
    console.error(err);
    addChatMessage("⚠️ AI request failed. Check the console for details.", "ai");
  }
}

// ---------------- Search & Filter ----------------
if (searchIngredient && filterRisk) {
  searchIngredient.addEventListener("input", filterIngredients);
  filterRisk.addEventListener("change", filterIngredients);
}
function filterIngredients() {
  const searchVal = searchIngredient.value.toLowerCase();
  const filterVal = filterRisk.value;

  ingredientCards.forEach(card => {
    const matchesSearch = card.textContent.toLowerCase().includes(searchVal);
    const matchesFilter = filterVal === "all" || card.dataset.risk === filterVal;
    card.style.display = (matchesSearch && matchesFilter) ? "inline-block" : "none";
  });
}

// ---------------- Scan History ----------------
function saveToHistory(imageUrl, summary) {
  if (!imageUrl) return;
  scanHistory.unshift({ image: imageUrl, summary, date: new Date().toLocaleString() });
  scanHistory = scanHistory.slice(0, 5);
  localStorage.setItem("scanHistory", JSON.stringify(scanHistory));
  renderHistory();
}
function renderHistory() {
  if (!historyList) return;
  historyList.innerHTML = "";
  scanHistory.forEach(item => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `<img src="${item.image}"><div><b>${item.summary}</b><br><small>${item.date}</small></div>`;
    historyList.appendChild(div);
  });
}
