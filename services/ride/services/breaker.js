// Circuit breaker. When an outside service (the free map servers) keeps failing,
// we stop calling it for a while instead of piling up slow, doomed requests.
//
//   closed    -> normal, calls go through
//   open      -> too many failures in a row, calls fail instantly for `openMs`
//   half-open -> after that pause ONE call is let through; success closes, failure re-opens

const registry = new Map();

class Breaker {
    constructor(name, { threshold = 5, openMs = 10000 } = {}) {
        this.name = name;
        this.threshold = threshold;
        this.openMs = openMs;
        this.failures = 0;
        this.openUntil = 0;
        this.trial = false;
        registry.set(name, this);
    }

    get state() {
        if (this.openUntil === 0) return 'closed';
        return Date.now() < this.openUntil ? 'open' : 'half-open';
    }

    async run(fn) {
        const state = this.state;

        if (state === 'open' || (state === 'half-open' && this.trial)) {
            throw new Error(`${this.name} is temporarily unavailable`);
        }
        if (state === 'half-open') this.trial = true;

        try {
            const result = await fn();
            this.failures = 0;
            this.openUntil = 0;
            this.trial = false;
            return result;
        } catch (err) {
            this.failures++;
            this.trial = false;
            if (this.failures >= this.threshold || state === 'half-open') {
                this.openUntil = Date.now() + this.openMs;
            }
            throw err;
        }
    }
}

module.exports = { Breaker, states: () => Object.fromEntries([ ...registry ].map(([ name, b ]) => [ name, b.state ])) };
