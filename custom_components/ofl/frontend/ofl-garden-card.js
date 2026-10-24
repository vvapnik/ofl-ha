/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const R = globalThis, j = R.ShadowRoot && (R.ShadyCSS === void 0 || R.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype, D = Symbol(), V = /* @__PURE__ */ new WeakMap();
let it = class {
  constructor(t, e, s) {
    if (this._$cssResult$ = !0, s !== D) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t, this.t = e;
  }
  get styleSheet() {
    let t = this.o;
    const e = this.t;
    if (j && t === void 0) {
      const s = e !== void 0 && e.length === 1;
      s && (t = V.get(e)), t === void 0 && ((this.o = t = new CSSStyleSheet()).replaceSync(this.cssText), s && V.set(e, t));
    }
    return t;
  }
  toString() {
    return this.cssText;
  }
};
const ht = (r) => new it(typeof r == "string" ? r : r + "", void 0, D), dt = (r, ...t) => {
  const e = r.length === 1 ? r[0] : t.reduce((s, i, o) => s + ((n) => {
    if (n._$cssResult$ === !0) return n.cssText;
    if (typeof n == "number") return n;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + n + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(i) + r[o + 1], r[0]);
  return new it(e, r, D);
}, pt = (r, t) => {
  if (j) r.adoptedStyleSheets = t.map((e) => e instanceof CSSStyleSheet ? e : e.styleSheet);
  else for (const e of t) {
    const s = document.createElement("style"), i = R.litNonce;
    i !== void 0 && s.setAttribute("nonce", i), s.textContent = e.cssText, r.appendChild(s);
  }
}, q = j ? (r) => r : (r) => r instanceof CSSStyleSheet ? ((t) => {
  let e = "";
  for (const s of t.cssRules) e += s.cssText;
  return ht(e);
})(r) : r;
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const { is: ut, defineProperty: gt, getOwnPropertyDescriptor: ft, getOwnPropertyNames: _t, getOwnPropertySymbols: $t, getPrototypeOf: vt } = Object, N = globalThis, F = N.trustedTypes, mt = F ? F.emptyScript : "", bt = N.reactiveElementPolyfillSupport, A = (r, t) => r, L = { toAttribute(r, t) {
  switch (t) {
    case Boolean:
      r = r ? mt : null;
      break;
    case Object:
    case Array:
      r = r == null ? r : JSON.stringify(r);
  }
  return r;
}, fromAttribute(r, t) {
  let e = r;
  switch (t) {
    case Boolean:
      e = r !== null;
      break;
    case Number:
      e = r === null ? null : Number(r);
      break;
    case Object:
    case Array:
      try {
        e = JSON.parse(r);
      } catch {
        e = null;
      }
  }
  return e;
} }, rt = (r, t) => !ut(r, t), Z = { attribute: !0, type: String, converter: L, reflect: !1, useDefault: !1, hasChanged: rt };
Symbol.metadata ??= Symbol("metadata"), N.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
let b = class extends HTMLElement {
  static addInitializer(t) {
    this._$Ei(), (this.l ??= []).push(t);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t, e = Z) {
    if (e.state && (e.attribute = !1), this._$Ei(), this.prototype.hasOwnProperty(t) && ((e = Object.create(e)).wrapped = !0), this.elementProperties.set(t, e), !e.noAccessor) {
      const s = Symbol(), i = this.getPropertyDescriptor(t, s, e);
      i !== void 0 && gt(this.prototype, t, i);
    }
  }
  static getPropertyDescriptor(t, e, s) {
    const { get: i, set: o } = ft(this.prototype, t) ?? { get() {
      return this[e];
    }, set(n) {
      this[e] = n;
    } };
    return { get: i, set(n) {
      const l = i?.call(this);
      o?.call(this, n), this.requestUpdate(t, l, s);
    }, configurable: !0, enumerable: !0 };
  }
  static getPropertyOptions(t) {
    return this.elementProperties.get(t) ?? Z;
  }
  static _$Ei() {
    if (this.hasOwnProperty(A("elementProperties"))) return;
    const t = vt(this);
    t.finalize(), t.l !== void 0 && (this.l = [...t.l]), this.elementProperties = new Map(t.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(A("finalized"))) return;
    if (this.finalized = !0, this._$Ei(), this.hasOwnProperty(A("properties"))) {
      const e = this.properties, s = [..._t(e), ...$t(e)];
      for (const i of s) this.createProperty(i, e[i]);
    }
    const t = this[Symbol.metadata];
    if (t !== null) {
      const e = litPropertyMetadata.get(t);
      if (e !== void 0) for (const [s, i] of e) this.elementProperties.set(s, i);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [e, s] of this.elementProperties) {
      const i = this._$Eu(e, s);
      i !== void 0 && this._$Eh.set(i, e);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(t) {
    const e = [];
    if (Array.isArray(t)) {
      const s = new Set(t.flat(1 / 0).reverse());
      for (const i of s) e.unshift(q(i));
    } else t !== void 0 && e.push(q(t));
    return e;
  }
  static _$Eu(t, e) {
    const s = e.attribute;
    return s === !1 ? void 0 : typeof s == "string" ? s : typeof t == "string" ? t.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = !1, this.hasUpdated = !1, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t) => this.enableUpdating = t), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t) => t(this));
  }
  addController(t) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t), this.renderRoot !== void 0 && this.isConnected && t.hostConnected?.();
  }
  removeController(t) {
    this._$EO?.delete(t);
  }
  _$E_() {
    const t = /* @__PURE__ */ new Map(), e = this.constructor.elementProperties;
    for (const s of e.keys()) this.hasOwnProperty(s) && (t.set(s, this[s]), delete this[s]);
    t.size > 0 && (this._$Ep = t);
  }
  createRenderRoot() {
    const t = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return pt(t, this.constructor.elementStyles), t;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(!0), this._$EO?.forEach((t) => t.hostConnected?.());
  }
  enableUpdating(t) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t) => t.hostDisconnected?.());
  }
  attributeChangedCallback(t, e, s) {
    this._$AK(t, s);
  }
  _$ET(t, e) {
    const s = this.constructor.elementProperties.get(t), i = this.constructor._$Eu(t, s);
    if (i !== void 0 && s.reflect === !0) {
      const o = (s.converter?.toAttribute !== void 0 ? s.converter : L).toAttribute(e, s.type);
      this._$Em = t, o == null ? this.removeAttribute(i) : this.setAttribute(i, o), this._$Em = null;
    }
  }
  _$AK(t, e) {
    const s = this.constructor, i = s._$Eh.get(t);
    if (i !== void 0 && this._$Em !== i) {
      const o = s.getPropertyOptions(i), n = typeof o.converter == "function" ? { fromAttribute: o.converter } : o.converter?.fromAttribute !== void 0 ? o.converter : L;
      this._$Em = i;
      const l = n.fromAttribute(e, o.type);
      this[i] = l ?? this._$Ej?.get(i) ?? l, this._$Em = null;
    }
  }
  requestUpdate(t, e, s, i = !1, o) {
    if (t !== void 0) {
      const n = this.constructor;
      if (i === !1 && (o = this[t]), s ??= n.getPropertyOptions(t), !((s.hasChanged ?? rt)(o, e) || s.useDefault && s.reflect && o === this._$Ej?.get(t) && !this.hasAttribute(n._$Eu(t, s)))) return;
      this.C(t, e, s);
    }
    this.isUpdatePending === !1 && (this._$ES = this._$EP());
  }
  C(t, e, { useDefault: s, reflect: i, wrapped: o }, n) {
    s && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t) && (this._$Ej.set(t, n ?? e ?? this[t]), o !== !0 || n !== void 0) || (this._$AL.has(t) || (this.hasUpdated || s || (e = void 0), this._$AL.set(t, e)), i === !0 && this._$Em !== t && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t));
  }
  async _$EP() {
    this.isUpdatePending = !0;
    try {
      await this._$ES;
    } catch (e) {
      Promise.reject(e);
    }
    const t = this.scheduleUpdate();
    return t != null && await t, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [i, o] of this._$Ep) this[i] = o;
        this._$Ep = void 0;
      }
      const s = this.constructor.elementProperties;
      if (s.size > 0) for (const [i, o] of s) {
        const { wrapped: n } = o, l = this[i];
        n !== !0 || this._$AL.has(i) || l === void 0 || this.C(i, void 0, o, l);
      }
    }
    let t = !1;
    const e = this._$AL;
    try {
      t = this.shouldUpdate(e), t ? (this.willUpdate(e), this._$EO?.forEach((s) => s.hostUpdate?.()), this.update(e)) : this._$EM();
    } catch (s) {
      throw t = !1, this._$EM(), s;
    }
    t && this._$AE(e);
  }
  willUpdate(t) {
  }
  _$AE(t) {
    this._$EO?.forEach((e) => e.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = !0, this.firstUpdated(t)), this.updated(t);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = !1;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t) {
    return !0;
  }
  update(t) {
    this._$Eq &&= this._$Eq.forEach((e) => this._$ET(e, this[e])), this._$EM();
  }
  updated(t) {
  }
  firstUpdated(t) {
  }
};
b.elementStyles = [], b.shadowRootOptions = { mode: "open" }, b[A("elementProperties")] = /* @__PURE__ */ new Map(), b[A("finalized")] = /* @__PURE__ */ new Map(), bt?.({ ReactiveElement: b }), (N.reactiveElementVersions ??= []).push("2.1.2");
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const B = globalThis, J = (r) => r, U = B.trustedTypes, K = U ? U.createPolicy("lit-html", { createHTML: (r) => r }) : void 0, ot = "$lit$", _ = `lit$${Math.random().toFixed(9).slice(2)}$`, nt = "?" + _, wt = `<${nt}>`, m = document, E = () => m.createComment(""), S = (r) => r === null || typeof r != "object" && typeof r != "function", W = Array.isArray, yt = (r) => W(r) || typeof r?.[Symbol.iterator] == "function", T = `[ 	
\f\r]`, x = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g, Y = /-->/g, Q = />/g, $ = RegExp(`>|${T}(?:([^\\s"'>=/]+)(${T}*=${T}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g"), X = /'/g, G = /"/g, at = /^(?:script|style|textarea|title)$/i, lt = (r) => (t, ...e) => ({ _$litType$: r, strings: t, values: e }), d = lt(1), xt = lt(2), w = Symbol.for("lit-noChange"), h = Symbol.for("lit-nothing"), tt = /* @__PURE__ */ new WeakMap(), v = m.createTreeWalker(m, 129);
function ct(r, t) {
  if (!W(r) || !r.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return K !== void 0 ? K.createHTML(t) : t;
}
const At = (r, t) => {
  const e = r.length - 1, s = [];
  let i, o = t === 2 ? "<svg>" : t === 3 ? "<math>" : "", n = x;
  for (let l = 0; l < e; l++) {
    const a = r[l];
    let p, u, c = -1, g = 0;
    for (; g < a.length && (n.lastIndex = g, u = n.exec(a), u !== null); ) g = n.lastIndex, n === x ? u[1] === "!--" ? n = Y : u[1] !== void 0 ? n = Q : u[2] !== void 0 ? (at.test(u[2]) && (i = RegExp("</" + u[2], "g")), n = $) : u[3] !== void 0 && (n = $) : n === $ ? u[0] === ">" ? (n = i ?? x, c = -1) : u[1] === void 0 ? c = -2 : (c = n.lastIndex - u[2].length, p = u[1], n = u[3] === void 0 ? $ : u[3] === '"' ? G : X) : n === G || n === X ? n = $ : n === Y || n === Q ? n = x : (n = $, i = void 0);
    const f = n === $ && r[l + 1].startsWith("/>") ? " " : "";
    o += n === x ? a + wt : c >= 0 ? (s.push(p), a.slice(0, c) + ot + a.slice(c) + _ + f) : a + _ + (c === -2 ? l : f);
  }
  return [ct(r, o + (r[e] || "<?>") + (t === 2 ? "</svg>" : t === 3 ? "</math>" : "")), s];
};
class C {
  constructor({ strings: t, _$litType$: e }, s) {
    let i;
    this.parts = [];
    let o = 0, n = 0;
    const l = t.length - 1, a = this.parts, [p, u] = At(t, e);
    if (this.el = C.createElement(p, s), v.currentNode = this.el.content, e === 2 || e === 3) {
      const c = this.el.content.firstChild;
      c.replaceWith(...c.childNodes);
    }
    for (; (i = v.nextNode()) !== null && a.length < l; ) {
      if (i.nodeType === 1) {
        if (i.hasAttributes()) for (const c of i.getAttributeNames()) if (c.endsWith(ot)) {
          const g = u[n++], f = i.getAttribute(c).split(_), O = /([.?@])?(.*)/.exec(g);
          a.push({ type: 1, index: o, name: O[2], strings: f, ctor: O[1] === "." ? Et : O[1] === "?" ? St : O[1] === "@" ? Ct : M }), i.removeAttribute(c);
        } else c.startsWith(_) && (a.push({ type: 6, index: o }), i.removeAttribute(c));
        if (at.test(i.tagName)) {
          const c = i.textContent.split(_), g = c.length - 1;
          if (g > 0) {
            i.textContent = U ? U.emptyScript : "";
            for (let f = 0; f < g; f++) i.append(c[f], E()), v.nextNode(), a.push({ type: 2, index: ++o });
            i.append(c[g], E());
          }
        }
      } else if (i.nodeType === 8) if (i.data === nt) a.push({ type: 2, index: o });
      else {
        let c = -1;
        for (; (c = i.data.indexOf(_, c + 1)) !== -1; ) a.push({ type: 7, index: o }), c += _.length - 1;
      }
      o++;
    }
  }
  static createElement(t, e) {
    const s = m.createElement("template");
    return s.innerHTML = t, s;
  }
}
function y(r, t, e = r, s) {
  if (t === w) return t;
  let i = s !== void 0 ? e._$Co?.[s] : e._$Cl;
  const o = S(t) ? void 0 : t._$litDirective$;
  return i?.constructor !== o && (i?._$AO?.(!1), o === void 0 ? i = void 0 : (i = new o(r), i._$AT(r, e, s)), s !== void 0 ? (e._$Co ??= [])[s] = i : e._$Cl = i), i !== void 0 && (t = y(r, i._$AS(r, t.values), i, s)), t;
}
class kt {
  constructor(t, e) {
    this._$AV = [], this._$AN = void 0, this._$AD = t, this._$AM = e;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t) {
    const { el: { content: e }, parts: s } = this._$AD, i = (t?.creationScope ?? m).importNode(e, !0);
    v.currentNode = i;
    let o = v.nextNode(), n = 0, l = 0, a = s[0];
    for (; a !== void 0; ) {
      if (n === a.index) {
        let p;
        a.type === 2 ? p = new P(o, o.nextSibling, this, t) : a.type === 1 ? p = new a.ctor(o, a.name, a.strings, this, t) : a.type === 6 && (p = new Pt(o, this, t)), this._$AV.push(p), a = s[++l];
      }
      n !== a?.index && (o = v.nextNode(), n++);
    }
    return v.currentNode = m, i;
  }
  p(t) {
    let e = 0;
    for (const s of this._$AV) s !== void 0 && (s.strings !== void 0 ? (s._$AI(t, s, e), e += s.strings.length - 2) : s._$AI(t[e])), e++;
  }
}
class P {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t, e, s, i) {
    this.type = 2, this._$AH = h, this._$AN = void 0, this._$AA = t, this._$AB = e, this._$AM = s, this.options = i, this._$Cv = i?.isConnected ?? !0;
  }
  get parentNode() {
    let t = this._$AA.parentNode;
    const e = this._$AM;
    return e !== void 0 && t?.nodeType === 11 && (t = e.parentNode), t;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t, e = this) {
    t = y(this, t, e), S(t) ? t === h || t == null || t === "" ? (this._$AH !== h && this._$AR(), this._$AH = h) : t !== this._$AH && t !== w && this._(t) : t._$litType$ !== void 0 ? this.$(t) : t.nodeType !== void 0 ? this.T(t) : yt(t) ? this.k(t) : this._(t);
  }
  O(t) {
    return this._$AA.parentNode.insertBefore(t, this._$AB);
  }
  T(t) {
    this._$AH !== t && (this._$AR(), this._$AH = this.O(t));
  }
  _(t) {
    this._$AH !== h && S(this._$AH) ? this._$AA.nextSibling.data = t : this.T(m.createTextNode(t)), this._$AH = t;
  }
  $(t) {
    const { values: e, _$litType$: s } = t, i = typeof s == "number" ? this._$AC(t) : (s.el === void 0 && (s.el = C.createElement(ct(s.h, s.h[0]), this.options)), s);
    if (this._$AH?._$AD === i) this._$AH.p(e);
    else {
      const o = new kt(i, this), n = o.u(this.options);
      o.p(e), this.T(n), this._$AH = o;
    }
  }
  _$AC(t) {
    let e = tt.get(t.strings);
    return e === void 0 && tt.set(t.strings, e = new C(t)), e;
  }
  k(t) {
    W(this._$AH) || (this._$AH = [], this._$AR());
    const e = this._$AH;
    let s, i = 0;
    for (const o of t) i === e.length ? e.push(s = new P(this.O(E()), this.O(E()), this, this.options)) : s = e[i], s._$AI(o), i++;
    i < e.length && (this._$AR(s && s._$AB.nextSibling, i), e.length = i);
  }
  _$AR(t = this._$AA.nextSibling, e) {
    for (this._$AP?.(!1, !0, e); t !== this._$AB; ) {
      const s = J(t).nextSibling;
      J(t).remove(), t = s;
    }
  }
  setConnected(t) {
    this._$AM === void 0 && (this._$Cv = t, this._$AP?.(t));
  }
}
class M {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t, e, s, i, o) {
    this.type = 1, this._$AH = h, this._$AN = void 0, this.element = t, this.name = e, this._$AM = i, this.options = o, s.length > 2 || s[0] !== "" || s[1] !== "" ? (this._$AH = Array(s.length - 1).fill(new String()), this.strings = s) : this._$AH = h;
  }
  _$AI(t, e = this, s, i) {
    const o = this.strings;
    let n = !1;
    if (o === void 0) t = y(this, t, e, 0), n = !S(t) || t !== this._$AH && t !== w, n && (this._$AH = t);
    else {
      const l = t;
      let a, p;
      for (t = o[0], a = 0; a < o.length - 1; a++) p = y(this, l[s + a], e, a), p === w && (p = this._$AH[a]), n ||= !S(p) || p !== this._$AH[a], p === h ? t = h : t !== h && (t += (p ?? "") + o[a + 1]), this._$AH[a] = p;
    }
    n && !i && this.j(t);
  }
  j(t) {
    t === h ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t ?? "");
  }
}
class Et extends M {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t) {
    this.element[this.name] = t === h ? void 0 : t;
  }
}
class St extends M {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t) {
    this.element.toggleAttribute(this.name, !!t && t !== h);
  }
}
class Ct extends M {
  constructor(t, e, s, i, o) {
    super(t, e, s, i, o), this.type = 5;
  }
  _$AI(t, e = this) {
    if ((t = y(this, t, e, 0) ?? h) === w) return;
    const s = this._$AH, i = t === h && s !== h || t.capture !== s.capture || t.once !== s.once || t.passive !== s.passive, o = t !== h && (s === h || i);
    i && this.element.removeEventListener(this.name, this, s), o && this.element.addEventListener(this.name, this, t), this._$AH = t;
  }
  handleEvent(t) {
    typeof this._$AH == "function" ? this._$AH.call(this.options?.host ?? this.element, t) : this._$AH.handleEvent(t);
  }
}
class Pt {
  constructor(t, e, s) {
    this.element = t, this.type = 6, this._$AN = void 0, this._$AM = e, this.options = s;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t) {
    y(this, t);
  }
}
const Ot = B.litHtmlPolyfillSupport;
Ot?.(C, P), (B.litHtmlVersions ??= []).push("3.3.3");
const Rt = (r, t, e) => {
  const s = e?.renderBefore ?? t;
  let i = s._$litPart$;
  if (i === void 0) {
    const o = e?.renderBefore ?? null;
    s._$litPart$ = i = new P(t.insertBefore(E(), o), o, void 0, e ?? {});
  }
  return i._$AI(r), i;
};
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const I = globalThis;
class k extends b {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t.firstChild, t;
  }
  update(t) {
    const e = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t), this._$Do = Rt(e, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(!0);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(!1);
  }
  render() {
    return w;
  }
}
k._$litElement$ = !0, k.finalized = !0, I.litElementHydrateSupport?.({ LitElement: k });
const Ut = I.litElementPolyfillSupport;
Ut?.({ LitElement: k });
(I.litElementVersions ??= []).push("4.2.2");
const et = {
  en: {
    loading: "Loading your garden…",
    no_garden: "No Open Farm Link garden is set up yet. Add one under Settings → Devices & services.",
    offline: "Offline",
    ok: "All good",
    problem: "Needs attention",
    back: "Back",
    thirsty: "Thirsty — could use water",
    wet: "Very wet",
    watered: "Well watered",
    no_moisture: "No moisture sensor",
    moisture: "moisture",
    target: "target",
    water_now: "Water now",
    watering: "Watering…",
    light_on: "Light is on — tap to turn off",
    light_off: "Light is off — tap to turn on",
    auto_watering: "Automatic watering",
    auto_lighting: "Automatic lighting",
    vacation: "Vacation mode",
    tank: "Water tank",
    clock: "Device clock",
    hw_problem: "A module of this plant is faulted or unreachable.",
    head_unit: "Head unit",
    vitals: { temp: "Temperature", humidity: "Air humidity", light: "Light", weight: "Weight", distance: "Distance", water_level: "Water level", moisture: "Soil moisture" },
    clock_state: { ntp: "synced (NTP)", manual: "set manually", none: "not set" }
  },
  ru: {
    loading: "Загружаем ваш сад…",
    no_garden: "Сад Open Farm Link ещё не настроен. Добавьте его в Настройки → Устройства и службы.",
    offline: "Нет связи",
    ok: "Всё хорошо",
    problem: "Требует внимания",
    back: "Назад",
    thirsty: "Пора полить",
    wet: "Очень влажно",
    watered: "Полито в меру",
    no_moisture: "Нет датчика влажности",
    moisture: "влажность",
    target: "цель",
    water_now: "Полить сейчас",
    watering: "Поливаем…",
    light_on: "Свет включён — нажмите, чтобы выключить",
    light_off: "Свет выключен — нажмите, чтобы включить",
    auto_watering: "Автополив",
    auto_lighting: "Автосвет",
    vacation: "Режим отпуска",
    tank: "Бак с водой",
    clock: "Часы устройства",
    hw_problem: "Модуль этого растения неисправен или недоступен.",
    head_unit: "Головной блок",
    vitals: { temp: "Температура", humidity: "Влажность воздуха", light: "Освещённость", weight: "Вес", distance: "Расстояние", water_level: "Уровень воды", moisture: "Влажность почвы" },
    clock_state: { ntp: "синхронизированы (NTP)", manual: "выставлены вручную", none: "не выставлены" }
  }
};
function Ht(r) {
  return r?.startsWith("ru") ? et.ru : et.en;
}
const Nt = dt`
  :host {
    --ofl-good: var(--success-color, #4caf6f);
    --ofl-warn: var(--warning-color, #e0a23b);
    --ofl-wet: var(--info-color, #4f8cff);
    --ofl-idle: var(--disabled-text-color, #9e9e9e);
    --ofl-radius: var(--ha-card-border-radius, 12px);
  }
  ha-card {
    padding: 16px;
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .empty {
    color: var(--secondary-text-color);
    text-align: center;
    padding: 16px 0;
  }

  /* ---- header ---- */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
  }
  .title {
    font-size: 1.25em;
    font-weight: 500;
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip {
    flex: none;
    font-size: 0.8em;
    padding: 2px 10px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .chip-ok {
    color: var(--ofl-good);
    background: color-mix(in srgb, var(--ofl-good) 15%, transparent);
  }
  .chip-warn {
    color: var(--ofl-warn);
    background: color-mix(in srgb, var(--ofl-warn) 15%, transparent);
  }
  .chip-off {
    color: var(--error-color, #db4437);
    background: color-mix(in srgb, var(--error-color, #db4437) 15%, transparent);
  }
  .chip-info {
    color: var(--ofl-wet);
    background: color-mix(in srgb, var(--ofl-wet) 20%, transparent);
  }

  /* ---- rack ---- */
  .rack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head-unit {
    position: relative;
    height: 56px;
    border: none;
    border-radius: var(--ofl-radius);
    background: linear-gradient(180deg, #3a3f45, #1d2124);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 0 12px;
  }
  .head-band {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 5px;
    transform: translateY(-50%);
    background: linear-gradient(90deg, #b98a5a, #e0b988, #b98a5a);
  }
  .head-label {
    position: relative;
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #e3e6e8;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.55);
    padding: 3px 12px;
    border-radius: 999px;
  }
  .head-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    text-transform: none;
    letter-spacing: normal;
  }
  .tray {
    border: 1px solid var(--divider-color);
    border-left: 4px solid var(--ofl-good);
    border-radius: var(--ofl-radius);
    background: var(--secondary-background-color, transparent);
    padding: 8px 12px 10px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: background 0.15s;
  }
  .tray:hover {
    background: color-mix(in srgb, var(--primary-color) 6%, var(--secondary-background-color, transparent));
  }
  .tray-problem {
    border-left-color: var(--ofl-warn);
  }
  .tray-lights {
    display: flex;
    gap: 6px;
    justify-content: center;
  }
  .tray-lights span {
    width: 22px;
    height: 4px;
    border-radius: 2px;
    background: var(--divider-color);
  }
  .tray-lights.lit span {
    background: #fff3c4;
    box-shadow: 0 0 6px #ffd95a;
  }
  .tray-body {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tray-text {
    flex: 1;
    min-width: 0;
  }
  .tray-name {
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .tray-sub {
    font-size: 0.85em;
    color: var(--secondary-text-color);
  }
  .warn-icon {
    color: var(--ofl-warn);
  }

  /* ---- plant icon / tones ---- */
  .plant-icon {
    width: 40px;
    height: 40px;
    flex: none;
  }
  .tone-good {
    color: var(--ofl-good);
  }
  .tone-warn {
    color: var(--ofl-warn);
  }
  .tone-wet {
    color: var(--ofl-wet);
  }
  .tone-idle {
    color: var(--ofl-idle);
  }
  .tone-border-good {
    border-color: var(--ofl-good) !important;
  }
  .tone-border-warn {
    border-color: var(--ofl-warn) !important;
  }
  .tone-border-wet {
    border-color: var(--ofl-wet) !important;
  }
  .tone-bg-good {
    background: var(--ofl-good);
  }
  .tone-bg-warn {
    background: var(--ofl-warn);
  }
  .tone-bg-wet {
    background: var(--ofl-wet);
  }

  /* ---- plant / head views ---- */
  .plant-view {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    padding: 4px 0;
    color: var(--primary-color);
  }
  .hero {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hero .plant-icon {
    width: 56px;
    height: 56px;
  }
  .hero-name {
    font-size: 1.3em;
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .hero-species {
    color: var(--secondary-text-color);
    text-transform: capitalize;
  }
  .alert {
    border-radius: var(--ofl-radius);
    padding: 8px 12px;
    color: var(--ofl-warn);
    background: color-mix(in srgb, var(--ofl-warn) 12%, transparent);
  }
  .status-card {
    border: 2px solid var(--ofl-idle);
    border-radius: var(--ofl-radius);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    cursor: pointer;
  }
  .status-label {
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .bar-track {
    position: relative;
    height: 10px;
    background: var(--divider-color);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar-range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--ofl-good) 30%, transparent);
  }
  .bar-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    border-radius: 999px;
    opacity: 0.85;
  }
  .bar-label {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 0.85em;
    color: var(--secondary-text-color);
  }
  .big-action,
  .secondary-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    border-radius: var(--ofl-radius);
    padding: 10px 14px;
  }
  .big-action {
    border: none;
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
    font-weight: 500;
    font-size: 1.05em;
  }
  .big-action[disabled] {
    opacity: 0.6;
    cursor: progress;
  }
  .secondary-action {
    border: 1px solid var(--divider-color);
    background: none;
    color: var(--primary-text-color);
  }
  .secondary-action.on ha-icon {
    color: #f4b400;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
    border-top: 1px solid var(--divider-color);
    color: var(--primary-text-color);
    cursor: pointer;
  }
  .row-value {
    color: var(--secondary-text-color);
    text-align: right;
  }
`, Mt = 6e4;
function st(r) {
  return d`<svg class="plant-icon tone-${r}" viewBox="0 0 48 48" aria-hidden="true">
    ${xt`<path d="M24 40V22" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none" />
    <path d="M24 26C24 26 12 24 12 14C22 14 24 22 24 26Z" fill="currentColor" opacity="0.85" />
    <path d="M24 30C24 30 36 28 36 18C26 18 24 26 24 30Z" fill="currentColor" />
    <path d="M24 34C24 34 15 33 15 25C22 25 24 30 24 34Z" fill="currentColor" opacity="0.65" />`}
  </svg>`;
}
const H = class H extends k {
  constructor() {
    super(...arguments), this._view = { kind: "rack" }, this._loading = !1;
  }
  // ---- Lovelace card contract -------------------------------------------
  setConfig(t) {
    this._config = t;
  }
  getCardSize() {
    return 2 + (this._garden?.plants.length ?? 2) * 2;
  }
  static getStubConfig() {
    return {};
  }
  // ---- Data -----------------------------------------------------------------
  connectedCallback() {
    super.connectedCallback(), this._timer = window.setInterval(() => this._loadStructure(), Mt);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), window.clearInterval(this._timer);
  }
  willUpdate(t) {
    t.has("hass") && this.hass && this._gardens === void 0 && !this._loading && this._loadStructure();
  }
  async _loadStructure() {
    if (this.hass) {
      this._loading = !0;
      try {
        const t = await this.hass.callWS({ type: "ofl/gardens" });
        this._gardens = t.gardens, this._error = void 0;
      } catch (t) {
        this._error = t.message ?? String(t);
      } finally {
        this._loading = !1;
      }
    }
  }
  get _garden() {
    const t = this._gardens ?? [];
    return this._config?.garden_id ? t.find((e) => e.garden_id === this._config.garden_id) : t[0];
  }
  get _t() {
    return Ht(this.hass?.locale?.language ?? this.hass?.language);
  }
  _state(t, e) {
    const s = t[e];
    return s ? this.hass?.states[s] : void 0;
  }
  _num(t, e) {
    const s = Number(this._state(t, e)?.state);
    return Number.isFinite(s) ? s : void 0;
  }
  _isOn(t, e) {
    return this._state(t, e)?.state === "on";
  }
  _call(t, e, s, i = {}) {
    !s || !this.hass || this.hass.callService(t, e, { entity_id: s, ...i });
  }
  _moreInfo(t) {
    t && this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: t }, bubbles: !0, composed: !0 }));
  }
  // ---- Plant semantics --------------------------------------------------------
  _moisture(t) {
    const e = this._t, s = this._num(t.entities, "vital/moisture"), i = t.targets.moisture_percent;
    return s === void 0 ? { tone: "idle", label: e.no_moisture } : i ? s < i.min ? { value: s, tone: "warn", label: e.thirsty } : s > i.max ? { value: s, tone: "wet", label: e.wet } : { value: s, tone: "good", label: e.watered } : { value: s, tone: "good", label: `${s}% ${e.moisture}` };
  }
  _lightOn(t) {
    return t["actuator/light_switch"] ? this._isOn(t, "actuator/light_switch") : (this._num(t, "actuator/dimmer") ?? 0) > 0;
  }
  _toggleLight(t) {
    const e = t.entities;
    if (e["actuator/light_switch"]) return this._call("switch", "toggle", e["actuator/light_switch"]);
    const s = e["actuator/dimmer"];
    if (!s) return;
    const i = Number(this.hass?.states[s]?.attributes.max) || 100, o = Number(t.targets.light_lux ?? t.targets.light_flux) || i / 2;
    this._call("number", "set_value", s, { value: this._lightOn(e) ? 0 : Math.min(o, i) });
  }
  // ---- Rendering -------------------------------------------------------------------
  render() {
    const t = this._t;
    if (this._error) return d`<ha-card><div class="empty">${this._error}</div></ha-card>`;
    if (!this._gardens) return d`<ha-card><div class="empty">${t.loading}</div></ha-card>`;
    const e = this._garden;
    if (!e) return d`<ha-card><div class="empty">${t.no_garden}</div></ha-card>`;
    const s = this._view, i = s.kind === "plant" ? e.plants.find((o) => o.plant_id === s.plantId) : void 0;
    return d`<ha-card>
      ${s.kind === "head" ? this._renderHead(e) : i ? this._renderPlant(i) : this._renderRack(e)}
    </ha-card>`;
  }
  _renderHeader(t) {
    const e = this._t, s = this._isOn(t.entities, "status/status");
    return d`<div class="header">
      <div class="title">${this._config?.title ?? t.name}</div>
      ${t.online ? d`<span class="chip ${s ? "chip-warn" : "chip-ok"}">${s ? e.problem : e.ok}</span>` : d`<span class="chip chip-off">${e.offline}</span>`}
    </div>`;
  }
  _renderRack(t) {
    const e = this._t, s = this._num(t.system.entities, "vital/water_level"), i = this._isOn(t.entities, "pref/vacation_mode");
    return d`${this._renderHeader(t)}
      <div class="rack">
        <button class="head-unit" @click=${() => this._view = { kind: "head" }}>
          <div class="head-band"></div>
          <div class="head-label">
            <span>${t.type ?? e.head_unit}</span>
            <span class="head-meta">
              ${i ? d`<span title=${e.vacation}>🌴</span>` : h}
              ${s !== void 0 ? d`<span>💧 ${s}%</span>` : h}
            </span>
          </div>
        </button>
        ${t.plants.map((o) => this._renderTray(o))}
      </div>`;
  }
  _renderTray(t) {
    const e = this._moisture(t), s = this._lightOn(t.entities), i = t.status === "problem" || this._isOn(t.entities, "status/status");
    return d`<button
      class="tray ${i ? "tray-problem" : ""}"
      @click=${() => this._view = { kind: "plant", plantId: t.plant_id }}
    >
      <div class="tray-lights ${s ? "lit" : ""}"><span></span><span></span><span></span></div>
      <div class="tray-body">
        ${st(i ? "warn" : e.tone)}
        <div class="tray-text">
          <div class="tray-name">${t.name}</div>
          <div class="tray-sub">${e.value !== void 0 ? `${e.value}% · ${e.label}` : e.label}</div>
        </div>
        ${i ? d`<ha-icon class="warn-icon" icon="mdi:alert-circle"></ha-icon>` : h}
      </div>
    </button>`;
  }
  _renderPlant(t) {
    const e = this._t, s = t.entities, i = this._moisture(t), o = t.targets.moisture_percent, l = !!this._state(s, "button/water_now")?.attributes.watering || this._isOn(s, "actuator/valve"), a = !!(s["actuator/light_switch"] || s["actuator/dimmer"]), p = this._lightOn(s), u = Object.keys(s).filter((c) => c.startsWith("vital/") && c !== "vital/moisture");
    return d`<div class="plant-view">
      <button class="back" @click=${() => this._view = { kind: "rack" }}>
        <ha-icon icon="mdi:arrow-left"></ha-icon>${e.back}
      </button>

      <div class="hero">
        ${st(i.tone)}
        <div>
          <div class="hero-name">${t.name}</div>
          ${t.species ? d`<div class="hero-species">${t.species}</div>` : h}
        </div>
      </div>

      ${t.status === "problem" ? d`<div class="alert">${e.hw_problem}</div>` : h}

      <div class="status-card tone-border-${i.tone}" @click=${() => this._moreInfo(s["vital/moisture"])}>
        <div class="status-label">${i.label}</div>
        ${i.value !== void 0 ? d`<div class="bar">
                <div class="bar-track">
                  ${o ? d`<div class="bar-range" style="left:${o.min}%;width:${o.max - o.min}%"></div>` : h}
                  <div class="bar-fill tone-bg-${i.tone}" style="width:${Math.max(0, Math.min(100, i.value))}%"></div>
                </div>
                <div class="bar-label">
                  <span>${i.value}% ${e.moisture}</span>
                  ${o ? d`<span>${e.target} ${o.min}–${o.max}%</span>` : h}
                </div>
              </div>` : h}
      </div>

      ${s["button/water_now"] ? d`<button
            class="big-action"
            ?disabled=${l}
            @click=${() => this._call("button", "press", s["button/water_now"])}
          >
            <ha-icon icon="mdi:watering-can"></ha-icon>${l ? e.watering : e.water_now}
          </button>` : h}
      ${a ? d`<button class="secondary-action ${p ? "on" : ""}" @click=${() => this._toggleLight(t)}>
            <ha-icon icon=${p ? "mdi:white-balance-sunny" : "mdi:weather-night"}></ha-icon>
            ${p ? e.light_on : e.light_off}
          </button>` : h}

      <div class="rows">
        ${this._toggleRow(s["grow_flag/watering_enabled"], e.auto_watering)}
        ${this._toggleRow(s["grow_flag/lighting_enabled"], e.auto_lighting)}
        ${u.map((c) => this._valueRow(s[c], e.vitals[c.slice(6)] ?? c.slice(6)))}
      </div>
    </div>`;
  }
  _renderHead(t) {
    const e = this._t, s = t.system.entities, i = this._state(t.entities, "diag/time_source")?.state, o = Object.keys(s).filter((l) => l.startsWith("vital/")), n = Object.keys(s).filter((l) => l.startsWith("actuator/"));
    return d`<div class="plant-view">
      <button class="back" @click=${() => this._view = { kind: "rack" }}>
        <ha-icon icon="mdi:arrow-left"></ha-icon>${e.back}
      </button>
      ${this._renderHeader(t)}
      <div class="rows">
        ${o.map((l) => this._valueRow(s[l], l === "vital/water_level" ? e.tank : e.vitals[l.slice(6)] ?? l.slice(6)))}
        ${n.map((l) => this._valueRow(s[l], this.hass?.states[s[l]]?.attributes.friendly_name ?? l))}
        ${this._toggleRow(t.entities["pref/vacation_mode"], e.vacation)}
        ${i ? d`<div class="row" @click=${() => this._moreInfo(t.entities["diag/time_source"])}>
              <span>${e.clock}</span><span class="row-value">${e.clock_state[i] ?? i}</span>
            </div>` : h}
      </div>
    </div>`;
  }
  _toggleRow(t, e) {
    if (!t) return h;
    const s = this.hass?.states[t]?.state === "on";
    return d`<div class="row">
      <span @click=${() => this._moreInfo(t)}>${e}</span>
      <ha-switch .checked=${s} @change=${() => this._call("switch", s ? "turn_off" : "turn_on", t)}></ha-switch>
    </div>`;
  }
  _valueRow(t, e) {
    if (!t) return h;
    const s = this.hass?.states[t], i = s?.attributes.unit_of_measurement ?? "";
    return d`<div class="row" @click=${() => this._moreInfo(t)}>
      <span>${e}</span><span class="row-value">${s ? `${s.state}${i ? ` ${i}` : ""}` : "—"}</span>
    </div>`;
  }
};
H.styles = Nt, H.properties = {
  hass: { attribute: !1 },
  _config: { state: !0 },
  _gardens: { state: !0 },
  _error: { state: !0 },
  _view: { state: !0 }
};
let z = H;
customElements.get("ofl-garden-card") || (customElements.define("ofl-garden-card", z), window.customCards = window.customCards ?? [], window.customCards.push({
  type: "ofl-garden-card",
  name: "Open Farm Link garden",
  description: "Your rack at a glance: plants, moisture, water and light.",
  preview: !0
}));
