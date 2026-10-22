const { getRedisConnection } = require("../config/redis");

class SessionService {
	constructor() {
		this.revokedAfter = new Map();
		this.activeJti = new Map(); // In-memory fallback for active JTI per wallet
		this.ipBindings = new Map(); // In-memory fallback for JTI -> IP subnet bindings
		this.blacklist = new Map(); // In-memory blacklist for revoked JTIs (JTI -> expireAt timestamp)
		this.disconnectionTimers = new Map(); // Key: `${gameId}:${playerAddress}`
		this.io = null;
	}

	init(io) {
		this.io = io;
	}

	async getClient() {
		return getRedisConnection();
	}

	key(address) {
		return `auth:revoked-after:${address}`;
	}

	/**
	 * Generate Redis key for storing active JTI for a wallet address.
	 * @param {string} address - Stellar wallet address
	 * @returns {string} Redis key
	 */
	activeJtiKey(address) {
		return `session:active-jti:${address}`;
	}

	/**
	 * Generate Redis key for blacklisting a revoked JTI.
	 * @param {string} jti - JWT ID
	 * @returns {string} Redis key
	 */
	blacklistKey(jti) {
		return `session:blacklist:${jti}`;
	}

	/**
	 * Generate Redis key for storing IP binding for a JTI.
	 * @param {string} jti - JWT ID
	 * @returns {string} Redis key
	 */
	ipBindingKey(jti) {
		return `session:ip-binding:${jti}`;
	}

	/**
	 * Rotate session token: invalidate old JTI and store new active JTI for wallet.
	 * When a user logs in with a new wallet or reconnects, the previous JTI is blacklisted.
	 *
	 * @param {string} address - Stellar wallet address
	 * @param {string} newJti - New JWT ID
	 * @param {string} ipSubnet - Client IP subnet (e.g., "192.168.1" for /24)
	 * @param {number} ttlSeconds - Token TTL in seconds
	 * @returns {Promise<void>}
	 */
	async rotateSession(address, newJti, ipSubnet, ttlSeconds) {
		if (!address || !newJti || !ttlSeconds) {
			throw new Error("address, newJti, and ttlSeconds are required for session rotation");
		}

		const client = await this.getClient();
		const oldJti = this.activeJti.get(address);
		const now = Date.now();
		const expireAt = now + ttlSeconds * 1000;

		try {
			if (client) {
				// Blacklist the old JTI (revoke it)
				if (oldJti) {
					await client.set(this.blacklistKey(oldJti), "revoked", "EX", ttlSeconds);
				}

				// Store new active JTI for this wallet
				await client.set(this.activeJtiKey(address), newJti, "EX", ttlSeconds);

				// Store IP binding for the new JTI
				if (ipSubnet) {
					await client.set(this.ipBindingKey(newJti), ipSubnet, "EX", ttlSeconds);
				}
			}

			// Maintain in-memory fallback
			if (oldJti) {
				this.blacklist.set(oldJti, expireAt);
			}
			this.activeJti.set(address, newJti);
			if (ipSubnet) {
				this.ipBindings.set(newJti, ipSubnet);
			}
		} catch (error) {
			console.warn("[SessionService] Redis session rotation failed; using local state:", error.message);
			// Still update local state on Redis failure for resilience
			if (oldJti) {
				this.blacklist.set(oldJti, expireAt);
			}
			this.activeJti.set(address, newJti);
			if (ipSubnet) {
				this.ipBindings.set(newJti, ipSubnet);
			}
		}
	}

	/**
	 * Check if a JTI (session token ID) is blacklisted.
	 *
	 * @param {string} jti - JWT ID to check
	 * @returns {Promise<boolean>} true if blacklisted
	 */
	async isJtiBlacklisted(jti) {
		if (!jti) return true;

		const now = Date.now();

		// Check local blacklist first (faster, no Redis needed)
		const localExpireAt = this.blacklist.get(jti);
		if (localExpireAt !== undefined) {
			return now <= localExpireAt; // Return true if not yet expired
		}

		const client = await this.getClient();
		if (client) {
			try {
				const result = await client.get(this.blacklistKey(jti));
				return result !== null;
			} catch (error) {
				console.warn("[SessionService] Redis blacklist read failed:", error.message);
			}
		}

		// Not found in either store = not blacklisted
		return false;
	}

	/**
	 * Get the IP subnet binding for a JTI.
	 *
	 * @param {string} jti - JWT ID
	 * @returns {Promise<string|null>} IP subnet or null
	 */
	async getIpBinding(jti) {
		if (!jti) return null;

		const client = await this.getClient();
		if (client) {
			try {
				const ipSubnet = await client.get(this.ipBindingKey(jti));
				return ipSubnet;
			} catch (error) {
				console.warn("[SessionService] Redis IP binding read failed:", error.message);
			}
		}

		// Fallback: check local state
		return this.ipBindings.get(jti) || null;
	}

	/**
	 * Verify that the request IP subnet matches the token's bound IP.
	 * Allows localhost (127.0.0.1) for testing.
	 *
	 * @param {string} boundIpSubnet - IP subnet from token binding
	 * @param {string} currentIpSubnet - Current request IP subnet
	 * @returns {boolean} true if IPs match or are both localhost
	 */
	isIpSubnetMatch(boundIpSubnet, currentIpSubnet) {
		if (!boundIpSubnet || !currentIpSubnet) return true; // No binding = allow all
		if (boundIpSubnet === currentIpSubnet) return true;
		// Allow localhost bypass for testing
		if (boundIpSubnet === "127.0.0.1" || currentIpSubnet === "127.0.0.1") return true;
		return false;
	}

	async revokeAll(address) {
		const revokedAt = Date.now();
		this.revokedAfter.set(address, revokedAt);
		this.activeJti.delete(address); // Clear active JTI on account deletion
		const client = await this.getClient();
		if (client) {
			// Account deletion is permanent, and JWT lifetime is configurable. Keep
			// the cutoff until an explicit account-restoration flow removes it.
			try {
				await client.set(this.key(address), String(revokedAt));
				await client.del(this.activeJtiKey(address)); // Also delete from Redis
			} catch (error) {
				console.warn("[SessionService] Redis revocation write failed; using local state:", error.message);
			}
		}
		return revokedAt;
	}

	async isTokenRevoked(address, issuedAtSeconds) {
		if (!address || !issuedAtSeconds) return true;
		let revokedAt = this.revokedAfter.get(address) || 0;
		const client = await this.getClient();
		if (client) {
			try {
				const stored = Number(await client.get(this.key(address))) || 0;
				revokedAt = Math.max(revokedAt, stored);
			} catch (error) {
				console.warn("[SessionService] Redis revocation read failed; using local state:", error.message);
			}
		}
		return issuedAtSeconds * 1000 <= revokedAt;
	}

	/**
	 * Start a disconnection grace countdown for an active player in a game.
	 * Emits OPPONENT_DISCONNECTED event to the game room with gracePeriodRemainingMs.
	 *
	 * @param {string} gameId - Game code / ID
	 * @param {string} playerAddress - Wallet address of disconnected player
	 * @param {string} opponentAddress - Wallet address of the active opponent
	 * @param {Function} [onTimeout] - Optional callback to invoke on timer expiration
	 * @param {number} [graceDurationMs=60000] - Grace period in milliseconds (default 60s)
	 * @returns {object|null} Timer state metadata
	 */
	startDisconnectionGrace(gameId, playerAddress, opponentAddress, onTimeout, graceDurationMs = 60000) {
		if (!gameId || !playerAddress) return null;

		const key = `${gameId}:${playerAddress}`;
		this.cancelDisconnectionGrace(gameId, playerAddress, false);

		const expiresAt = Date.now() + graceDurationMs;

		if (this.io) {
			this.io.to(gameId).emit("OPPONENT_DISCONNECTED", {
				gameId,
				playerAddress,
				opponentAddress,
				gracePeriodRemainingMs: graceDurationMs,
			});
			this.io.to(gameId).emit("opponent_disconnected", {
				gameCode: gameId,
				playerAddress,
				opponentAddress,
				gracePeriodRemainingMs: graceDurationMs,
			});
		}

		const timeout = setTimeout(async () => {
			this.disconnectionTimers.delete(key);
			if (typeof onTimeout === "function") {
				try {
					await onTimeout();
				} catch (err) {
					console.error(`[SessionService] onTimeout callback error for ${key}:`, err.message);
				}
			} else {
				try {
					const gameModel = require("../models/gameModel");
					if (typeof gameModel.updateGameResult === "function") {
						await gameModel.updateGameResult(gameId, { winner: opponentAddress, reason: "abandonment" });
					}
					if (opponentAddress) {
						try {
							const escrowService = require("./escrowService");
							if (typeof escrowService.resolveMatch === "function") {
								await escrowService.resolveMatch(gameId, opponentAddress).catch((err) => {
									console.error(`[SessionService] resolveMatch failed for ${gameId}:`, err.message);
								});
							}
						} catch (_) {}
					}
					if (this.io) {
						this.io.to(gameId).emit("game_over", {
							gameCode: gameId,
							winner: opponentAddress,
							reason: "abandonment",
						});
					}
				} catch (err) {
					console.error(`[SessionService] auto-forfeit failed for ${key}:`, err.message);
				}
			}
		}, graceDurationMs);

		const entry = {
			timeout,
			expiresAt,
			graceDurationMs,
			gameId,
			playerAddress,
			opponentAddress,
		};
		this.disconnectionTimers.set(key, entry);
		return entry;
	}

	/**
	 * Cancel a pending disconnection grace timer when a player reconnects.
	 * Emits OPPONENT_RECONNECTED event to the game room.
	 *
	 * @param {string} gameId
	 * @param {string} playerAddress
	 * @param {boolean} [emitReconnected=true]
	 * @returns {boolean} true if an active timer was cancelled
	 */
	cancelDisconnectionGrace(gameId, playerAddress, emitReconnected = true) {
		const key = `${gameId}:${playerAddress}`;
		const entry = this.disconnectionTimers.get(key);
		if (entry) {
			if (entry.timeout) {
				clearTimeout(entry.timeout);
			}
			this.disconnectionTimers.delete(key);
			if (emitReconnected && this.io) {
				this.io.to(gameId).emit("OPPONENT_RECONNECTED", {
					gameId,
					playerAddress,
				});
				this.io.to(gameId).emit("opponent_reconnected", {
					gameCode: gameId,
					playerAddress,
				});
			}
			return true;
		}
		return false;
	}

	/**
	 * Check if a player in a game has a pending disconnection grace timer.
	 *
	 * @param {string} gameId
	 * @param {string} playerAddress
	 * @returns {boolean}
	 */
	isPendingDisconnection(gameId, playerAddress) {
		return this.disconnectionTimers.has(`${gameId}:${playerAddress}`);
	}

	/**
	 * Get the remaining grace duration in milliseconds for a disconnected player.
	 *
	 * @param {string} gameId
	 * @param {string} playerAddress
	 * @returns {number} Remaining milliseconds, or 0 if not active
	 */
	getGraceRemainingMs(gameId, playerAddress) {
		const entry = this.disconnectionTimers.get(`${gameId}:${playerAddress}`);
		if (!entry) return 0;
		return Math.max(0, entry.expiresAt - Date.now());
	}

	resetLocalState() {
		this.revokedAfter.clear();
		this.activeJti.clear();
		this.ipBindings.clear();
		this.blacklist.clear();
		for (const [, entry] of this.disconnectionTimers) {
			if (entry && entry.timeout) clearTimeout(entry.timeout);
		}
		this.disconnectionTimers.clear();
	}
}

module.exports = new SessionService();
module.exports.SessionService = SessionService;
