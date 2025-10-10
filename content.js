(async () => {
	if (window.remiliaContentInjected) return;
	window.remiliaContentInjected = true;

	let coreUrl;
	try {
		coreUrl = chrome.runtime.getURL("shoutboxCore.js");
	} catch (error) {
		console.error("Remilia shoutbox failed to resolve core module", error);
		return;
	}
	let mountShoutbox;
	try {
		({ mountShoutbox } = await import(coreUrl));
	} catch (error) {
		console.error("Remilia shoutbox failed to import core module", error);
		return;
	}

	const mounted = new WeakMap();
	let mounting = null;

	const ensureMounted = async () => {
		const activeTab = document.querySelector(".tab.pictochat.active");
		const container = document.querySelector(".coming-soon-content");
		if (!activeTab || !container) return;

		const current = mounted.get(container);
		if (current) {
			await current.refresh("dom-check");
			return;
		}

		if (mounting) {
			await mounting;
			return;
		}

		mounting = mountShoutbox(container, { context: "content" });
		try {
			const instance = await mounting;
			mounted.set(container, instance);
		} finally {
			mounting = null;
		}
	};

	const observer = new MutationObserver(() => {
		ensureMounted();
	});
	observer.observe(document.body, { childList: true, subtree: true });

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") ensureMounted();
	});

	ensureMounted();
})();
