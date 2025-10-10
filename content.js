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
	const USERNAME_KEY = "shoutbox_username";
	const LOGIN_TYPE_KEY = "shoutbox_login_type";

	let presenceChannel = null;
	let typingChannel = null;
	let messageChannel = null;
	let pollTimer = null;

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
	const deriveUsername = (user) => {
		if (!user) return null;
		const meta = user.user_metadata || {};
		return (
			meta.user_name ||
			meta.preferred_username ||
			meta.full_name ||
			meta.name ||
			(user.email ? user.email.split("@")[0] : null) ||
			`user_${user.id.slice(0, 6)}`
		);
	};
	const clearStoredUser = () => {
		localStorage.removeItem(USERNAME_KEY);
		localStorage.removeItem(LOGIN_TYPE_KEY);
	};
	const cleanupChannel = async (ch) => {
		if (!ch) return;
		try {
			await ch.unsubscribe();
		} catch (_) {}
		try {
			await supabase.removeChannel(ch);
		} catch (_) {}
	};
	const cleanupChat = async () => {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		await Promise.all(
			[presenceChannel, typingChannel, messageChannel].map(cleanupChannel)
		);
		presenceChannel = null;
		typingChannel = null;
		messageChannel = null;
	};
	const waitForComingSoon = (cb) => {
		const soon = document.querySelector(".coming-soon-content");
		if (soon) {
			cb(soon);
			return;
		}
		const watcher = new MutationObserver(() => {
			const target = document.querySelector(".coming-soon-content");
			if (target) {
				watcher.disconnect();
				cb(target);
			}
		});
		watcher.observe(document.body, { childList: true, subtree: true });
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
		if (!soon) {
			waitForComingSoon(() => injectAuthUI());
			return;
		}
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
			localStorage.setItem(USERNAME_KEY, u);
			localStorage.setItem(LOGIN_TYPE_KEY, "guest");
			injectChat(u);
		};
	}

	async function injectChat(username) {
		const soon = document.querySelector(".coming-soon-content");
		if (!soon) {
			waitForComingSoon(() => injectChat(username));
			return;
		}
		await cleanupChat();
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
				const loginType = localStorage.getItem(LOGIN_TYPE_KEY);
				await cleanupChat();
				if (loginType === "oauth") {
					await supabase.auth.signOut();
				}
				clearStoredUser();
				if (loginType !== "oauth") injectAuthUI();
			});

		// Presence
		presenceChannel = supabase.channel("presence", {
			config: { presence: { key: username } },
		});
		presenceChannel.on("presence", { event: "sync" }, () => {
			const count = Object.keys(presenceChannel.presenceState()).length;
			peerCountEl.textContent = `Online: ${count}`;
		});
		await presenceChannel.subscribe();

		// Load + poll fallback
		let lastMsgId = 0;
		async function loadMessages() {
			const { data, error } = await supabase
				.from("messages")
				.select("id,username,text,created_at")
				.order("created_at", { ascending: false })
				.limit(200);
			if (error || !data) return;
			messagesEl.innerHTML = "";
			const ordered = [...data].reverse();
			ordered.forEach((m) =>
				renderMessage(messagesEl, m.username, m.text, m.created_at)
			);
			const newest = ordered.at(-1);
			if (newest) {
				lastMsgId = Math.max(lastMsgId, newest.id);
			}
		}
		await loadMessages();
		pollTimer = setInterval(loadMessages, 5000); // fallback poll

		// Realtime with reconnect
		async function connectRealtime() {
			await cleanupChannel(messageChannel);
			messageChannel = supabase.channel("public:messages");
			messageChannel
				.on(
					"postgres_changes",
					{ event: "INSERT", schema: "public", table: "messages" },
					(payload) => {
						const m = payload.new;
						if (lastMsgId && m.id <= lastMsgId) return;
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
		typingChannel = supabase.channel("typing");
		typingChannel
			.on("broadcast", { event: "typing" }, (p) => {
				if (p.username === username) return;
				typingEl.style.display = "block";
				clearTimeout(window.typingHide);
				window.typingHide = setTimeout(
					() => (typingEl.style.display = "none"),
					1500
				);
			});
		typingChannel.subscribe();
		inputEl.addEventListener("input", () => {
			if (!typingChannel) return;
			typingChannel.send({
				type: "broadcast",
				event: "typing",
				payload: { username },
			});
		});

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
			const storedType = localStorage.getItem(LOGIN_TYPE_KEY);
			const stored = localStorage.getItem(USERNAME_KEY);
			if (stored && storedType === "guest") {
				injectChat(stored);
				return;
			}
			const { data } = await supabase.auth.getSession();
			const user = data?.session?.user;
			if (user) {
				const oauthName = deriveUsername(user);
				if (oauthName) {
					localStorage.setItem(USERNAME_KEY, oauthName);
					localStorage.setItem(LOGIN_TYPE_KEY, "oauth");
					injectChat(oauthName);
					return;
				}
			}
			clearStoredUser();
			injectAuthUI();
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });

	supabase.auth.onAuthStateChange(async (event, session) => {
		if (event === "SIGNED_IN") {
			const user = session?.user;
			const name = deriveUsername(user);
			if (!name) return;
			localStorage.setItem(USERNAME_KEY, name);
			localStorage.setItem(LOGIN_TYPE_KEY, "oauth");
			await injectChat(name);
		} else if (event === "SIGNED_OUT") {
			if (localStorage.getItem(LOGIN_TYPE_KEY) === "oauth") {
				clearStoredUser();
				await cleanupChat();
				injectAuthUI();
			}
		} else if (event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
			const user = session?.user;
			const name = deriveUsername(user);
			if (name) {
				localStorage.setItem(USERNAME_KEY, name);
				if (localStorage.getItem(LOGIN_TYPE_KEY) !== "guest") {
					localStorage.setItem(LOGIN_TYPE_KEY, "oauth");
				}
			}
		}
	});
})();
