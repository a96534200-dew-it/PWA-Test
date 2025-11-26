const plaintext = document.getElementById('plaintext');
var timeoutID = null;
const filenameBox = document.getElementById('file-name');

const controlsContainer = document.querySelector('.top-bar');
const KEY = 'MyNoteString';
const [counter1, counter2] = document.querySelectorAll('.counter');

console.log('SW: attempting register');
navigator.serviceWorker.register('./sw.js').then(r => console.log('reg', r)).catch(e => console.error('reg failed', e));

if ('serviceWorker' in navigator) {
	window.addEventListener('load' , () => {
		navigator.serviceWorker.register('/sw.js')
				.then(registration => {
			console.log('Service Worker registered with scope:' , registration.scope);
		}).catch(error => {
			console.log('Service Worker registration failed:' , error);
		});
	});
}

// Autosave to local storage
plaintext.value = localStorage.getItem(KEY) || '';
// Placing caret at the end
plaintext.setSelectionRange(plaintext.value.length, plaintext.value.length);
// Calculate text stats after load
calcStats();

function storeLocally() {
	localStorage.setItem(KEY, plaintext.value);
}

// Save before closing?
window.beforeunload = storeLocally;

plaintext.onkeyup = function () {
	// Calculate text stats
	calcStats();
	// Auto-save to local storage (at most once per second)
	window.clearTimeout(timeoutID);
	timeoutID = window.setTimeout(storeLocally, 1000);
}

function exportFile () {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([plaintext.value], { type: 'text/plain' }));
	a.download = (filenameBox.value || 'My Note.txt').replace(/^([^.]*)$/, "$1.txt");
	document.body.appendChild(a);
	console.log(a.href);
	a.click();
	// URL.revokeObjectURL(a.href);
	a.remove();
	// Revoke url with a delay
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function importFile () {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.txt,.md,text/plain';
	input.onchange = () => {
		const file = input.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			filenameBox.value = file.name;
			plaintext.value = reader.result;
		}
		reader.onerror = () => console.error('Read error', reader.error);
		reader.readAsText(file, 'utf-8');
	};
	input.click();
	input.remove();
}

function calcStats () {
	console.log('calcStats called')
	counter1.textContent = plaintext.value.length + ' chars';
	counter2.textContent = plaintext.value === "" ? 0 + ' words' : plaintext.value.replace(/\s+/g, ' ').split(' ').length + ' words';
	// counter3.textContent = plaintext.value.split(/\n/).length + ' lines';
}

function updCount () {

}

//Event listener for buttons
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
})
