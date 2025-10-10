const root = document.getElementById("popup-root");

try {
	const coreUrl = chrome.runtime.getURL("shoutboxCore.js");
	const { mountShoutbox } = await import(coreUrl);
	await mountShoutbox(root, { context: "popup" });
} catch (error) {
	console.error("Failed to mount shoutbox popup", error);
	root.innerHTML =
		'<div id="auth-screen"><p class="auth-note">Unable to load the shoutbox. Please try reopening the popup.</p></div>';
}
