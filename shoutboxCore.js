const SUPABASE_URL = "https://wwccwrrkspeugafsdxkj.supabase.co";
const SUPABASE_ANON_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Y2N3cnJrc3BldWdhZnNkeGtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NjI1NDYsImV4cCI6MjA3NTUzODU0Nn0.G-DycGQ8ENN9fuoQro4iq46A4-NoyPEYvLfcs-B6zc0";

const USERNAME_KEY = "shoutbox_username";
const LOGIN_TYPE_KEY = "shoutbox_login_type";
const MESSAGES_CACHE_KEY = "shoutbox_cached_messages";

const isExtensionContextValid = () => {
	try {
		return typeof chrome !== "undefined" && !!chrome?.runtime?.id;
	} catch (_) {
		return false;
	}
};

const getExtensionURL = (path) => {
	if (!isExtensionContextValid()) {
		throw new Error("Extension context invalidated");
	}
	return chrome.runtime.getURL(path);
};

const storageGet = async (key) => {
	if (!isExtensionContextValid()) return null;
	const storage = chrome?.storage?.local;
	if (!storage) return null;
	return new Promise((resolve) => {
		try {
			storage.get(key, (result) => {
				if (chrome.runtime.lastError) {
					console.warn(
						"Remilia shoutbox storage get failed",
						chrome.runtime.lastError
					);
					resolve(null);
					return;
				}
				resolve(result?.[key] ?? null);
			});
		} catch (error) {
			console.warn("Remilia shoutbox storage get threw", error);
			resolve(null);
		}
	});
};

const storageSet = async (key, value) => {
	if (!isExtensionContextValid()) return;
	const storage = chrome?.storage?.local;
	if (!storage) return;
	return new Promise((resolve) => {
		try {
			storage.set({ [key]: value }, () => {
				if (chrome.runtime.lastError) {
					console.warn(
						"Remilia shoutbox storage set failed",
						chrome.runtime.lastError
					);
				}
				resolve();
			});
		} catch (error) {
			console.warn("Remilia shoutbox storage set threw", error);
			resolve();
		}
	});
};

const storageRemoveKey = async (key) => {
	if (!isExtensionContextValid()) return;
	const storage = chrome?.storage?.local;
	if (!storage) return;
	return new Promise((resolve) => {
		try {
			storage.remove(key, () => {
				if (chrome.runtime.lastError) {
					console.warn(
						"Remilia shoutbox storage remove failed",
						chrome.runtime.lastError
					);
				}
				resolve();
			});
		} catch (error) {
			console.warn("Remilia shoutbox storage remove threw", error);
			resolve();
		}
	});
};

const storageRemoveMany = async (keys) => {
	if (!isExtensionContextValid()) return;
	const storage = chrome?.storage?.local;
	if (!storage) return;
	return new Promise((resolve) => {
		try {
			storage.remove(keys, () => {
				if (chrome.runtime.lastError) {
					console.warn(
						"Remilia shoutbox storage bulk remove failed",
						chrome.runtime.lastError
					);
				}
				resolve();
			});
		} catch (error) {
			console.warn("Remilia shoutbox storage bulk remove threw", error);
			resolve();
		}
	});
};

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
		(user.id ? `user_${user.id.slice(0, 6)}` : null)
	);
};

const renderMessage = (messagesEl, user, text, ts, sys = false) => {
	if (!messagesEl) return;
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
};

let cachedMessages = [];

const loadCache = async () => {
	const stored = await storageGet(MESSAGES_CACHE_KEY);
	return Array.isArray(stored) ? stored : [];
};

const persistCache = async () => {
	await storageSet(MESSAGES_CACHE_KEY, cachedMessages.slice(-200));
};

const upsertCachedMessage = async (msg) => {
	if (!msg || typeof msg.id !== "number") return;
	const idx = cachedMessages.findIndex((m) => m.id === msg.id);
	if (idx >= 0) cachedMessages[idx] = msg;
	else cachedMessages.push(msg);
	cachedMessages.sort((a, b) => (a.id || 0) - (b.id || 0));
	if (cachedMessages.length > 200) {
		cachedMessages = cachedMessages.slice(-200);
	}
	await persistCache();
};

cachedMessages = await loadCache();

const supabasePromise = (async () => {
	try {
		const supabaseSrc = getExtensionURL("supabase.min.js");
		await import(supabaseSrc);
		const { createClient } = window.supabase;
		const storageAdapter = {
			getItem: storageGet,
			setItem: storageSet,
			removeItem: storageRemoveKey,
		};
		return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: {
				storage: storageAdapter,
				storageKey: "remilia-shoutbox-session",
				autoRefreshToken: true,
				persistSession: true,
				detectSessionInUrl: true,
			},
		});
	} catch (error) {
		console.error(
			"Remilia shoutbox failed to initialise Supabase client",
			error
		);
		throw error;
	}
})();

const activeInstances = new Set();

const clearStoredUser = async () => {
	await storageRemoveMany([USERNAME_KEY, LOGIN_TYPE_KEY]);
};

const renderCachedMessages = (messagesEl) => {
	if (!messagesEl) return;
	cachedMessages.forEach((m) =>
		renderMessage(messagesEl, m.username, m.text, m.created_at)
	);
};

class ShoutboxInstance {
	constructor(container, options = {}) {
		this.container = container;
		this.options = options;
		this.supabase = null;
		this.messagesEl = null;
		this.inputEl = null;
		this.sendBtn = null;
		this.peerCountEl = null;
		this.typingEl = null;
		this.logoutBtn = null;

		this.presenceChannel = null;
		this.typingChannel = null;
		this.messageChannel = null;
		this.pollTimer = null;
		this.typingTimeout = null;

		this.username = null;
		this.lastMsgId = 0;
		this.sending = false;
		this.destroyed = false;
		this.refreshing = null;
		this.pendingRefresh = false;
		this.supabaseFailed = false;

		this.handleSendClick = null;
		this.handleInputKey = null;
		this.handleTypingInput = null;
		this.handleLogout = null;
		this.containerObserver = null;

		activeInstances.add(this);
		this.observeContainer();
	}

	async getSupabase() {
		if (!this.supabase) {
			this.supabase = await supabasePromise;
		}
		return this.supabase;
	}

	async ensureSupabase() {
		if (this.supabaseFailed) return null;
		try {
			return await this.getSupabase();
		} catch (error) {
			this.supabaseFailed = true;
			console.error("Remilia shoutbox Supabase unavailable", error);
			await this.showFatalError(
				"Chat backend unavailable. Reload the page to try again."
			);
			return null;
		}
	}

	async showFatalError(note) {
		if (this.destroyed) return;
		await this.cleanup();
		if (this.container) {
			this.container.innerHTML = `<div id="auth-screen"><p class="auth-note">${note}</p></div>`;
		}
	}

	observeContainer() {
		if (this.containerObserver) this.containerObserver.disconnect();
		const parent = this.container?.parentElement;
		if (!parent) return;
		this.containerObserver = new MutationObserver(() => {
			if (!this.container || !this.container.isConnected) {
				this.destroy();
			}
		});
		this.containerObserver.observe(parent, { childList: true });
	}

	async init() {
		await this.refresh("init");
	}

	async refresh(reason = "manual") {
		if (this.destroyed) return;
		if (this.refreshing) {
			this.pendingRefresh = true;
			return this.refreshing;
		}
		this.refreshing = (async () => {
			cachedMessages = await loadCache();
			const supabase = await this.ensureSupabase();
			if (!supabase) return;
			const storedType = await storageGet(LOGIN_TYPE_KEY);
			const storedName = await storageGet(USERNAME_KEY);
			const { data } = await supabase.auth.getSession();
			const user = data?.session?.user;
			if (user) {
				const oauthName = deriveUsername(user);
				if (oauthName) {
					await storageSet(USERNAME_KEY, oauthName);
					await storageSet(LOGIN_TYPE_KEY, "oauth");
					await this.showChat(oauthName);
					return;
				}
			}
			if (storedName && storedType === "guest") {
				await this.showChat(storedName);
				return;
			}
			await this.showAuth();
		})();
		try {
			await this.refreshing;
		} finally {
			this.refreshing = null;
		}
		if (this.pendingRefresh) {
			this.pendingRefresh = false;
			await this.refresh(reason);
		}
	}

	async showAuth() {
		if (this.destroyed) return;
		await this.cleanup();
		this.container.innerHTML = `
      <div id="auth-screen">
        <h2>Remilia Shoutbox</h2>
        <div class="auth-buttons">
          <button id="signin-twitter" class="auth-button auth-button--twitter" type="button">Sign in with X</button>
          <button id="guest-login" class="auth-button auth-button--guest" type="button">Continue as Guest</button>
        </div>
        <p class="auth-note">Sign in with X to post as your handle or continue as a guest.</p>
      </div>
    `;
		const twitterBtn = this.container.querySelector("#signin-twitter");
		const guestBtn = this.container.querySelector("#guest-login");
		if (twitterBtn) {
			twitterBtn.onclick = async () => {
				const supabase = await this.ensureSupabase();
				if (!supabase) return;
				await supabase.auth.signInWithOAuth({ provider: "twitter" });
			};
		}
		if (guestBtn) {
			guestBtn.onclick = async () => {
				const guestName = randomGuestName();
				await storageSet(USERNAME_KEY, guestName);
				await storageSet(LOGIN_TYPE_KEY, "guest");
				await this.showChat(guestName);
			};
		}
	}

	async cleanupChannel(channel) {
		if (!channel) return;
		try {
			await channel.unsubscribe();
		} catch (_) {}
		try {
			const supabase = await this.ensureSupabase();
			if (supabase) supabase.removeChannel(channel);
		} catch (_) {}
	}

	async cleanup() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		await this.cleanupChannel(this.presenceChannel);
		await this.cleanupChannel(this.typingChannel);
		await this.cleanupChannel(this.messageChannel);
		this.presenceChannel = null;
		this.typingChannel = null;
		this.messageChannel = null;

		if (this.typingTimeout) {
			clearTimeout(this.typingTimeout);
			this.typingTimeout = null;
		}

		if (this.sendBtn && this.handleSendClick)
			this.sendBtn.removeEventListener("click", this.handleSendClick);
		if (this.inputEl && this.handleInputKey)
			this.inputEl.removeEventListener("keydown", this.handleInputKey);
		if (this.inputEl && this.handleTypingInput)
			this.inputEl.removeEventListener("input", this.handleTypingInput);
		if (this.logoutBtn && this.handleLogout)
			this.logoutBtn.removeEventListener("click", this.handleLogout);

		this.messagesEl = null;
		this.inputEl = null;
		this.sendBtn = null;
		this.peerCountEl = null;
		this.typingEl = null;
		this.logoutBtn = null;

		this.handleSendClick = null;
		this.handleInputKey = null;
		this.handleTypingInput = null;
		this.handleLogout = null;

		this.lastMsgId = 0;
	}

	async showChat(username) {
		if (this.destroyed) return;
		const reuseExisting = this.username === username && this.messagesEl;
		if (reuseExisting) {
			if (!this.presenceChannel) await this.startPresence();
			if (!this.messageChannel) await this.connectRealtime();
			if (!this.typingChannel) await this.setupTypingChannel();
			if (!this.pollTimer) {
				this.pollTimer = setInterval(() => this.loadMessages(), 5000);
			}
			await this.loadMessages();
			return;
		}

		await this.cleanup();
		this.username = username;
		this.container.innerHTML = `
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
		this.messagesEl = this.container.querySelector("#shoutbox-messages");
		this.inputEl = this.container.querySelector("#shoutbox-input");
		this.sendBtn = this.container.querySelector("#send-btn");
		this.peerCountEl = this.container.querySelector("#peer-count");
		this.typingEl = this.container.querySelector("#typing-indicator");
		this.logoutBtn = this.container.querySelector("#logout-btn");

		if (this.messagesEl) this.messagesEl.innerHTML = "";
		renderCachedMessages(this.messagesEl);
		renderMessage(
			this.messagesEl,
			"",
			`Connected as ${username}`,
			Date.now(),
			true
		);

		this.handleLogout = async () => {
			const loginType = await storageGet(LOGIN_TYPE_KEY);
			await this.cleanup();
			if (loginType === "oauth") {
				const supabase = await this.ensureSupabase();
				if (supabase) await supabase.auth.signOut();
			}
			await clearStoredUser();
			await this.showAuth();
		};
		if (this.logoutBtn) {
			this.logoutBtn.addEventListener("click", this.handleLogout);
		}

		this.handleSendClick = () => this.sendMessage();
		this.handleInputKey = (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.sendMessage();
			}
		};
		this.handleTypingInput = () => this.sendTyping();

		if (this.sendBtn)
			this.sendBtn.addEventListener("click", this.handleSendClick);
		if (this.inputEl) {
			this.inputEl.addEventListener("keydown", this.handleInputKey);
			this.inputEl.addEventListener("input", this.handleTypingInput);
		}

		await this.startPresence();
		await this.loadMessages();
		this.pollTimer = setInterval(() => this.loadMessages(), 5000);
		await this.connectRealtime();
		await this.setupTypingChannel();
	}

	async startPresence() {
		if (!this.username) return;
		const supabase = await this.ensureSupabase();
		if (!supabase) return;
		await this.cleanupChannel(this.presenceChannel);
		this.presenceChannel = supabase.channel("presence", {
			config: { presence: { key: this.username } },
		});
		this.presenceChannel.on("presence", { event: "sync" }, () => {
			const state = this.presenceChannel?.presenceState?.() || {};
			const count = Object.keys(state).length;
			if (this.peerCountEl) this.peerCountEl.textContent = `Online: ${count}`;
		});
		await this.presenceChannel.subscribe();
	}

	async loadMessages() {
		if (!this.messagesEl) return;
		const supabase = await this.ensureSupabase();
		if (!supabase) return;
		const { data, error } = await supabase
			.from("messages")
			.select("id,username,text,created_at")
			.order("created_at", { ascending: false })
			.limit(200);
		if (error) {
			renderMessage(
				this.messagesEl,
				"",
				`Load failed: ${error.message}`,
				Date.now(),
				true
			);
			return;
		}
		this.messagesEl.innerHTML = "";
		const ordered = [...(data ?? [])].reverse();
		ordered.forEach((m) =>
			renderMessage(this.messagesEl, m.username, m.text, m.created_at)
		);
		cachedMessages = ordered;
		await persistCache();
		const newest = ordered.at(-1);
		if (newest?.id) {
			this.lastMsgId = Math.max(this.lastMsgId, newest.id);
		}
	}

	async connectRealtime() {
		const supabase = await this.ensureSupabase();
		if (!supabase) return;
		await this.cleanupChannel(this.messageChannel);
		this.messageChannel = supabase.channel("public:messages");
		this.messageChannel
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "messages" },
				async (payload) => {
					const m = payload.new;
					if (!this.messagesEl) return;
					if (this.lastMsgId && m.id <= this.lastMsgId) return;
					renderMessage(this.messagesEl, m.username, m.text, m.created_at);
					this.lastMsgId = m.id;
					await upsertCachedMessage(m);
				}
			)
			.subscribe((status) => {
				if (status === "CLOSED" || status === "TIMED_OUT") {
					setTimeout(() => {
						if (!this.destroyed) this.connectRealtime();
					}, 4000);
				}
			});
	}

	async setupTypingChannel() {
		const supabase = await this.ensureSupabase();
		if (!supabase) return;
		await this.cleanupChannel(this.typingChannel);
		this.typingChannel = supabase.channel("typing");
		this.typingChannel.on("broadcast", { event: "typing" }, (payload) => {
			if (!this.typingEl) return;
			if (payload.username === this.username) return;
			this.typingEl.style.display = "block";
			if (this.typingTimeout) clearTimeout(this.typingTimeout);
			this.typingTimeout = setTimeout(() => {
				if (this.typingEl) this.typingEl.style.display = "none";
				this.typingTimeout = null;
			}, 1500);
		});
		await this.typingChannel.subscribe();
	}

	sendTyping() {
		if (!this.typingChannel || !this.username) return;
		this.typingChannel.send({
			type: "broadcast",
			event: "typing",
			payload: { username: this.username },
		});
	}

	async sendMessage() {
		if (!this.username || this.sending) return;
		const supabase = await this.ensureSupabase();
		if (!supabase) return;
		if (!this.inputEl) return;
		const text = this.inputEl.value.trim();
		if (!text) return;
		this.inputEl.value = "";
		this.sending = true;
		const attemptInsert = async () =>
			supabase
				.from("messages")
				.insert([{ username: this.username, text }])
				.select("id,username,text,created_at")
				.single();
		try {
			let { data: inserted, error } = await attemptInsert();
			if (error && /token|expired/i.test(error.message)) {
				await supabase.auth.refreshSession();
				({ data: inserted, error } = await attemptInsert());
			}
			if (error) {
				renderMessage(
					this.messagesEl,
					"",
					`Send failed: ${error.message}`,
					Date.now(),
					true
				);
				this.inputEl.value = text;
				return;
			}
			if (inserted) {
				renderMessage(
					this.messagesEl,
					inserted.username,
					inserted.text,
					inserted.created_at
				);
				this.lastMsgId = Math.max(
					this.lastMsgId,
					inserted.id || this.lastMsgId
				);
				await upsertCachedMessage(inserted);
			}
			const { error: pruneError } = await supabase.rpc("prune_old_messages", {
				keep_count: 200,
			});
			if (pruneError) {
				renderMessage(
					this.messagesEl,
					"",
					`Cleanup failed: ${pruneError.message}`,
					Date.now(),
					true
				);
			}
		} finally {
			this.sending = false;
		}
	}

	async destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		if (this.containerObserver) this.containerObserver.disconnect();
		await this.cleanup();
		activeInstances.delete(this);
		if (this.container) this.container.innerHTML = "";
	}
}

export const mountShoutbox = async (container, options = {}) => {
	const instance = new ShoutboxInstance(container, options);
	await instance.init();
	return {
		async refresh(reason) {
			await instance.refresh(reason);
		},
		async destroy() {
			await instance.destroy();
		},
		get container() {
			return instance.container;
		},
	};
};

try {
	const supabase = await supabasePromise;
	supabase.auth.onAuthStateChange(async (event, session) => {
		if (event === "SIGNED_IN") {
			const name = deriveUsername(session?.user);
			if (name) {
				await storageSet(USERNAME_KEY, name);
				await storageSet(LOGIN_TYPE_KEY, "oauth");
			}
		} else if (event === "SIGNED_OUT") {
			await clearStoredUser();
		} else if (event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
			const name = deriveUsername(session?.user);
			if (name) {
				await storageSet(USERNAME_KEY, name);
				await storageSet(LOGIN_TYPE_KEY, "oauth");
			}
		}
		cachedMessages = await loadCache();
		for (const instance of Array.from(activeInstances)) {
			if (!instance.destroyed) {
				await instance.refresh(`auth:${event}`);
			}
		}
	});
} catch (error) {
	console.error(
		"Remilia shoutbox unable to attach Supabase auth listener",
		error
	);
}
