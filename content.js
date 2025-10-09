(async () => {
	if (window.remiliaInjected) return;
	window.remiliaInjected = true;

	const supabaseSrc = chrome.runtime.getURL("supabase.min.js");
	await import(supabaseSrc);
	const { createClient } = window.supabase;

	const SUPABASE_URL = "https://wwccwrrkspeugafsdxkj.supabase.co";
	const SUPABASE_ANON_KEY =
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Y2N3cnJrc3BldWdhZnNkeGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NjI1NDYsImV4cCI6MjA3NTUzODU0Nn0.G-DycGQ8ENN9fuoQro4iq46A4-NoyPEYvLfcs-B6zc0";

	const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

	// Helpers
	const randomGuestName = () => {
		const animals = ["cat", "bat", "fox", "crow", "otter", "bee", "moth"];
		return (
			"guest_" +
			animals[Math.floor(Math.random() * animals.length)] +
			Math.floor(Math.random() * 9999)
		);
	};
	const stringToColor = (str) => {
		let hash = 0;
		for (let i = 0; i < str.length; i++)
			hash = str.charCodeAt(i) + ((hash << 5) - hash);
		return `hsl(${Math.abs(hash) % 360},80%,70%)`;
	};
	function renderMessage(messagesEl, user, text, ts, sys = false) {
		const el = document.createElement("div");
		el.className = "msg" + (sys ? " sys" : "");
		const time = new Date(ts).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
		el.innerHTML = sys
			? `<i>${text}</i>`
			: `<b style="color:${stringToColor(
					user
			  )}">${user}</b>: ${text} <span class="time">${time}</span>`;
		messagesEl.appendChild(el);
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	async function injectAuthUI() {
		const soon = document.querySelector(".coming-soon-content");
		if (!soon) return;
		soon.innerHTML = `
      <div id="auth-screen">
        <h2>Remilia Shoutbox</h2>
        <button id="signin-twitter">Sign in with X</button>
        <button id="guest-login">Continue as Guest</button>
      </div>
    `;
		document.getElementById("signin-twitter").onclick = async () =>
			supabase.auth.signInWithOAuth({ provider: "twitter" });
		document.getElementById("guest-login").onclick = () => {
			const u = randomGuestName();
			localStorage.setItem("shoutbox_username", u);
			injectChat(u);
		};
	}

	async function injectChat(username) {
		const soon = document.querySelector(".coming-soon-content");
		soon.innerHTML = `
      <div id="shoutbox">
        <div id="shoutbox-header">
          <span>${username}</span>
          <button id="logout-btn">Log out</button>
        </div>
        <div id="shoutbox-body">
          <div id="peer-count">Online: 0</div>
          <div id="shoutbox-messages"></div>
          <div id="typing-indicator" style="display:none;">Typing...</div>
          <div id="shoutbox-input-row">
            <input id="shoutbox-input" placeholder="Say something..." maxlength="256">
            <button id="send-btn">Send</button>
          </div>
        </div>
      </div>
    `;

		const messagesEl = document.getElementById("shoutbox-messages");
		const inputEl = document.getElementById("shoutbox-input");
		const sendBtn = document.getElementById("send-btn");
		const peerCountEl = document.getElementById("peer-count");
		const typingEl = document.getElementById("typing-indicator");

		renderMessage(messagesEl, "", `Connected as ${username}`, Date.now(), true);

		document
			.getElementById("logout-btn")
			.addEventListener("click", async () => {
				await supabase.auth.signOut();
				localStorage.removeItem("shoutbox_username");
				injectAuthUI();
			});

		// Presence
		const presence = supabase.channel("presence", {
			config: { presence: { key: username } },
		});
		presence.on("presence", { event: "sync" }, () => {
			const count = Object.keys(presence.presenceState()).length;
			peerCountEl.textContent = `Online: ${count}`;
		});
		await presence.subscribe();

		// Load + poll fallback
		let lastMsgId = 0;
		async function loadMessages() {
			const { data } = await supabase
				.from("messages")
				.select("id,username,text,created_at")
				.order("created_at", { ascending: true })
				.limit(200);
			if (!data) return;
			messagesEl.innerHTML = "";
			data.forEach((m) =>
				renderMessage(messagesEl, m.username, m.text, m.created_at)
			);
			lastMsgId = data.at(-1)?.id || 0;
		}
		await loadMessages();
		setInterval(loadMessages, 5000); // fallback poll

		// Realtime with reconnect
		function connectRealtime() {
			const ch = supabase
				.channel("public:messages")
				.on(
					"postgres_changes",
					{ event: "INSERT", schema: "public", table: "messages" },
					(payload) => {
						const m = payload.new;
						renderMessage(messagesEl, m.username, m.text, m.created_at);
						lastMsgId = m.id;
					}
				)
				.subscribe((status) => {
					if (status === "CLOSED" || status === "TIMED_OUT") {
						setTimeout(connectRealtime, 4000);
					}
				});
		}
		connectRealtime();

		// Typing indicator
		const typing = supabase.channel("typing");
		typing
			.on("broadcast", { event: "typing" }, (p) => {
				if (p.username === username) return;
				typingEl.style.display = "block";
				clearTimeout(window.typingHide);
				window.typingHide = setTimeout(
					() => (typingEl.style.display = "none"),
					1500
				);
			})
			.subscribe();
		inputEl.addEventListener("input", () =>
			typing.send({
				type: "broadcast",
				event: "typing",
				payload: { username },
			})
		);

		async function sendMessage() {
			const t = inputEl.value.trim();
			if (!t) return;
			inputEl.value = "";
			await supabase.from("messages").insert([{ username, text: t }]);
			await supabase.rpc("prune_old_messages", { keep_count: 200 });
		}
		sendBtn.onclick = sendMessage;
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") sendMessage();
		});
	}

	// Re-inject when Pictochat tab becomes active
	const observer = new MutationObserver(async () => {
		const active = document.querySelector(".tab.pictochat.active");
		const soon = document.querySelector(".coming-soon-content");
		if (active && soon) {
			observer.disconnect();
			const stored = localStorage.getItem("shoutbox_username");
			if (stored) injectChat(stored);
			else injectAuthUI();
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
})();
