const plaintext = document.getElementById('plaintext');
const mdText = document.getElementById("mdText");
const nameInput = document.getElementById('file-name');
const controlsContainer = document.querySelector('.top-bar');
const KEY = 'MyNoteString';
const counter1 = document.querySelector('.counter');
const saveDot = document.getElementById("save-dot");
const modeBtn = document.getElementById("modeBtn");

// console.log('SW: attempting register');
// navigator.serviceWorker.register('./sw.js').then(r => console.log('reg', r)).catch(e => console.error('reg failed', e));

if ('serviceWorker' in navigator) {
	window.addEventListener('load' , () => {
		navigator.serviceWorker.register('./sw.js')
				.then(registration => {
			console.log('Service Worker registered with scope:' , registration.scope);
		}).catch(error => {
			console.log('Service Worker registration failed:' , error);
		});
	});
}

// Indexed DB stuffs - Creating DB here.
const DB = "mynotes", STORE = "notes", ID = "current"; // this is a fancy way to compact multiple variables.
let dbPromise = new Promise((reslt, rejct) => {
	const request = indexedDB.open(DB, 2);
	request.onupgradeneeded = () => {
		if (request.result.objectStoreNames.contains(STORE)) request.result.deleteObjectStore(STORE);
		request.result.createObjectStore(STORE, {keyPath: "id"});
	};
	request.onsuccess = () => reslt(request.result);
	request.onerror = () => rejct(request.error);
});

async function idbGet () {	// loading from Indexed DB
	const db = await dbPromise;
	return new Promise ((reslt, rejct) => {
		const request = db.transaction(STORE).objectStore(STORE).get(ID);
		request.onsuccess = () => reslt(request.result);
		request.onerror = () => rejct(request.error);
	});
}

async function idbSet (doc) {	// writing to Indexed DB
	const db = await dbPromise;
	return new Promise((reslt, rejct) => {
		const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(doc);
		request.onsuccess = () => reslt();
		request.onerror = () => rejct(request.error);
	});
}

// V4 upd
async function idbDel (id) {	// Ddeleting by ID, notice that
	const db = await dbPromise;
	return new Promise((reslt, rejct) => {
		const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
		request.onsuccess = () => reslt();
		request.onerror = () => rejct(request.error);
	});
}

async function idbGetById (id) {	// Getting by ID
	const db = await dbPromise;
	return new Promise((reslt, rejct) => {
		const request = db.transaction(STORE).objectStore(STORE).get(id);	// there is difference here ID vs id
		request.onsuccess = () => reslt(request.result);
		request.onerror = () => rejct(request.error);
	});
}

// Encryption stuffs:

function setText (text, save = true) {
	state.text = text;
	blocks = splitBlocks(text);
	if (!state.md) plaintext.value = text;
	updateCount();
	if (save) saveDebounced();
	if (state.md && state.editing < 0) renderMd();
}

async function encKey (password, salt) {
	const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
	return crypto.subtle.deriveKey({name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256"}, km, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]);
}

function b64e (buf) {
	const b = new Uint8Array(buf);
	let s = "";
	for (let i=0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));	// WTF is even that?
	return btoa(s);
}

function b64d (s) {
	const bin = atob(s);
	const b = new Uint8Array(bin.length);	// How and what?
	for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
	return b;
}

async function refreshLockHint () {	// Self defeating for secrecy?
	let v = null;
	try {v= await idbGetById("vault");
	} catch (err) {}
	nameInput.placeholder = v ? "locked" : "untitled.txt";
}

async function lockNote (password) {
	commitBlock(false);
	state.editing = -1;
	if (!state.text.trim()) {
		nameInput.value = state.docName;
		setDot("red", "nothing to lock");
		return;
	}
	setDot("orange", "encrypting");
	try {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = await encKey(password, salt);
		// ct - Cypher Text, iv - Initialisation Vector
		const ct = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(state.text));
		await idbSet ({id: "vault", name: state.noteName, data: b64e(ct), iv: b64e(iv), salt: b64e(salt), updatedAt: Date.now()});
		nameInput.value = "";
		state.docName = "";
		setText("");	// used here to clear the text field	
		// refreshLockHint();	// Is that necessary?
		setDot("limegreen", "locked");
	} catch (err) {
		console.error(err);
		nameInput.value = state.noteName;
		setDot("red", "lock failed");
	}
}

async function unlockNote (password) {
	commitBlock(false);
	state.editing = -1;
	setDot("orange", "decrypting");
	try {
		const vault = await idbGetById("vault");
		if (!vault) throw new Error("empty");
		const key = await encKey(password, b64d(vault.salt));
		const pt = await crypto.subtle.decrypt({name: "AES-GCM", iv: b64d(vault.iv)}, key, b64d(vault.data));
		await idbDel("vault");
		state.noteName = vault.name || "";
		nameInput.value = state.noteName;
		setText(new TextDecoder().decode(pt));
		// refreshLockHint();	// Is it necessary?
		setDot("limegreen", "unlcoked");
	} catch (err) {
		nameInput.value = state.noteName;
		setDot("red", "wrong password");
	}
}

// v3 upd Markdown stuff

// Declaring Object Literal to store state
const state = {
	text: "", 
	md: localStorage.getItem("pad.md") !== "off",
	editing: -1
};
let blocks = [""];		// clearing 'blocks'?

function esc(s) { //WHY?! Why again such micro-functions?
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); // What this is doing?
}

function md (src) {		// Where Md is actually parsed into Html?
	if (window.marked) return window.marked.parse(src);
	return "<p>" + esc(src) + "</p>";
}

function renderMd () {
	if (state.editing >= 0) return;
	mdText.innerHTML = "";
	blocks.forEach((block, i) => {		// creating blocks to render Md
		// console.log (block);
		const div = document.createElement("div");	
		div.className = "block" + (block.trim() === "" ? " empty-block" : "");
		div.dataset.idx = i;
		div.innerHTML = block.trim() === "" ? "empty - click to write" : md(block);		// Why "Html" was not highlighted as an error?!!
		mdText.appendChild(div);
	});
	if (!blocks.length || (blocks.length === 1 && blocks[0] === "" && !mdText.firstChild)) {
		const div = document.createElement("div");
		div.className = "block empty-block";
		div.dataset.idx = "0";
		div.textContent = "empty - click to write";
		mdText.appendChild(div);
	}
}

function autogrow (textArea) {
	textArea.style.height = "auto";
	textArea.style.height = textArea.scrollHeight + "px";	// WTF?!! Why none of this is suggested? Why it needs to be a Function?!
}

function joinBlocks (blocks) {		// isn't it better to just repeat?!
	return blocks.join("\n\n");		// why whole ass function?!
}

function tabIndent (textArea, out) {
	const val = textArea.value;		// why we need so many calcualtions?
	const start = textArea.selectionStart, end = textArea.selectionEnd;
	const lnStart = val.lastIndexOf("\n", start - 1) + 1; // WTF?!
	let lnEnd = val.indexOf("\n", end);
	if (lnEnd < 0) lnEnd = val.length;
	let dentStart = 0, dentEnd = 0;
	const n = val.slice(lnStart, lnEnd).split("\n").map((ln, k) => {
		if (out) {		// if Shift+Tab - match tab and remove it?
			const m = ln.match(/^(  |\t| )/);
			const cut = m ? m[0].length : 0;
			if (k === 0) dentStart = -cut;
			dentEnd -= cut;
			return ln.slice(cut);
		}
		if (k === 0) dentStart = 2;
		dentEnd += 2;
		return "\t" + ln;	// If not add two spaces
	}).join("\n");
	textArea.value = val.slice(0, lnStart) + n + val.slice(lnEnd);
	textArea.setSelectionRange(start + dentStart, end + dentEnd);
	textArea.dispatchEvent(new Event("input", {bubbles: true}));
}

function splitBlocks (src) {	// splitting at Md special symbols?
	// console.log ("splitBlocks called! -> \n" + src);
	const lines = src.split("\n");
	const out = [];
	let cur = [];
	let fence = null;
	const push = () => {
		const s = cur.join("\n").replace(/^\n+|\n+$/g, "");
		out.push(s);
		cur = [];
	};
	for (const ln of lines) {
		const m = ln.match(/^\s*(```|~~~)/);
		if (m) {
			if (!fence) fence = m[1];
			else if (ln.includes(fence)) fence = null;
			cur.push(ln);
			continue;
		}
		if (!fence && ln.trim() === "") {
			if (cur.length) push();	// it was here!
			continue;
		}
		cur.push(ln);
	}
	if (cur.length) push();
	// console.log(out);		// A-HA!! Error was in this function!
	return out.length ? out : [""];
}

let saveTimer = 0;
function saveDebounced () {
	setDot("orange", "unsaved changes");
	clearTimeout(saveTimer);
	saveTimer = setTimeout(async () => {
		try {
			idbSet({id: ID, name: nameInput.value, text: state.text, updatedAt: Date.now()});
			setDot("var(--col-accent)", "saved");
		} catch (err) {
			console.error(err);
			setDot("red", "save failed");
		}
	}, 400);	// Timeout count
}

function commitBlock (renderer = true) {
	const i = state.editing;
	state.editing = -1;
	if (i < 0) return;	// so previous state?
	blocks = splitBlocks(joinBlocks(blocks));	// What? Or it processing formatting characters here?
	state.text = joinBlocks(blocks);	// Again? What for it may do so?
	if (!state.md) plaintext.value = state.text;
	updateCount();
	saveDebounced();
	if (renderer && state.md) {
		renderMd();
		if (document.activeElement && mdText.contains(document.activeElement))
		document.activeElement.blur();
	}
}

function editBlock (i, focusEnd = true) {
	if (state.editing >= 0) commitBlock(false);	// what is commitBlock?!
	state.editing = i;	// why this isn't 0/1 ???
	const div = mdText.querySelector(`[data-idx="${i}"]`);	// WTF O-O ?!!
	if (!div) {state.editing = -1; return; }
	div.classList.add("editing");
	const textArea = document.createElement("textarea");
	textArea.className = "blockEdit";
	textArea.value = blocks[i];
	textArea.placeholder = "type markdown, Ctrl+Enter to finish";
	div.innerHTML = "";
	div.appendChild(textArea);
	autogrow(textArea);		// HUH?! What?!
	textArea.focus();
	if (focusEnd) textArea.setSelectionRange(textArea.value.length, textArea.value.length);	// set caret to the end of block. I know this ^_^
	textArea.addEventListener("input", () => {
		autogrow(textArea);
		blocks[i] = textArea.value;
		state.text = joinBlocks(blocks);
		if (!state.md) plaintext.value = state.text; // Whyyyy?!
		updateCount();
		saveDebounced();
	});
	textArea.addEventListener("keydown", (event) => {
		if (event.key === "Tab") { event.preventDefault(); tabIndent(textArea, event.shiftKey);}
		else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {event.preventDefault(); commitBlock(true);}
		else if (event.key === "Escape") {event.preventDefault(); commitBlock(true);}
	});
	textArea.addEventListener("blur", () => commitBlock(true));
}

function applyMode () {		// Assigning switch to the button
	modeBtn.setAttribute("aria-pressed", String(state.md)); // one that is an object, by the way.
	localStorage.setItem("pad.md", state.md ? "on" : "off");
	plaintext.hidden = state.md;	// switching what is shown
	mdText.hidden = !state.md;
	if (state.md) {
		commitBlock(false);
		state.editing = -1;
		blocks = splitBlocks(state.text);
		renderMd();
	} else {
		plaintext.value = state.text;	// if disabled just show text
	}
}

// Shortcuts explained!
function countWords (t) {
	t = t.trim();
	return t ? t.split(/\s+/).length : 0;
	// if (t === "") {
	// 	return 0
	// }
	// return t.split(/\s+/).length;
}

function updateCount () {
	const n = countWords(plaintext.value);
	counter1.textContent = n + (n === 1 ? " word" : " words");
	// if (n === 1) {
	// 	counter1.textContent = `${n} word`;
	// } else {
	// 	counter1.textContent = `${n} words`;
	// }
}

function setDot (color, label) {
	saveDot.style.background = color;
	saveDot.title = label;
}

function exportFile () {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([plaintext.value], { type: "text/plain" }));
	a.download = (nameInput.value.trim() || 'My Note.md').replace(/^([^.]*)$/, "$1.md");
	document.body.appendChild(a);
	// console.log(a.href);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function importFile () {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.txt,.md,text/plain';
	input.onchange = async () => {
		const file = fileInput.files[0];
		if (!file) return;
		commitBlock(false);
		state.editing =-1;
		state.text = await file.text();
		nameInput.value = file.name;
		blocks = splitBlocks(state.text);
		plaintext.value = state.text;
		updateCount();
		saveDebounced();
		if (state.md) renderMd();
		input.value = "";
	};
	input.click();
	input.remove();
}

// Markdown element events
mdText.addEventListener ("click", (element) => {
	if (state.editing >= 0) return;
	const block = element.target.closest(".block");
	if (block) editBlock(Number(block.dataset.idx));
	else {
		blocks.push("");
		state.text = joinBlocks(blocks);
		renderMd();
		editBlock(blocks.length - 1, false);
	}
});

// Auto save - Listening to updates in text - better than onkeyup.
plaintext.addEventListener ("input", () => {
	state.text = plaintext.value;		// passing text
	blocks = splitBlocks(state.text);
	updateCount();
	saveDebounced();	// check it if updated!!!
})

nameInput.addEventListener ("input", () => {
	// Encrypt part controls must be here
	saveDebounced();
});

// Triggers Encryption
nameInput.addEventListener ("blur", async () => {
	const match = nameInput.value.trim().match(/^(lock|unlock)\s*:\s*([\s\S]+)$/i);	// Matches as: Group1:command Group2:pass
	if (!match || !match[2].trim()) return;	// Set file name here!
	if (match[1].toLowerCase() === "lock") await lockNote(match[2].trim());
	else await unlockNote(match[2].trim());
});

nameInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter")
	nameInput.blur();
});

modeBtn.onclick = () => {
	state.md = !state.md;
	applyMode();
};

//Event listener for Export/Import buttons *only*!
controlsContainer.addEventListener("click", (event) => {
	// Check which button is pressed here
	if (event.target.className === "bar-button") {
		if (event.target.value === "Export") {
			console.log(event.target.value + ' is clicked');
			exportFile();
			event.stopPropagation();
		}
		if (event.target.value === "Import") {
			console.log(event.target.value + ' is clicked');
			importFile();
			event.stopPropagation();
		}
	}
});

// Auto load document for the FIRST TIME
(async () => {
	applyMode();
	setDot("var(--col3)", "loading");
	try {
		const doc = await idbGet();
		state.text = (doc && doc.text) || "";
		state.docName = (doc && doc.name) || "";
		if (doc && doc.name) nameInput.value = doc.name;
	} catch (err) {console.error(err);}
	blocks = splitBlocks(state.text);
	plaintext.value = state.text;
	updateCount();
	if (state.md) renderMd();
	setDot("var(--col-accent)", "saved");
})();