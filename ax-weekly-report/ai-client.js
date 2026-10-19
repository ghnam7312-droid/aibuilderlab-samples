/**
 * ai-client.js — AI 빌더랩 예시 서비스 공통 AI 호출기
 *
 * 서버(https://aibuilderlab.kr/api/demo/ai)가 Claude를 부르고, 작업(task)별 지시문과 출력 형식은 서버가 가진다.
 * 화면은 작업 이름과 입력만 보낸다. 키가 없거나, 한도를 넘거나, 네트워크가 끊기면 null을 돌려주고
 * 화면은 logic.js 의 규칙으로 처리한다. 그래서 이 파일이 실패해도 서비스는 멈추지 않는다.
 *
 * 사용:
 *   const r = await AI.ask("mail.classify", { from, subject, body });
 *   if (r) { r.data, r.ms }  else { 규칙으로 처리 }
 *   AI.status()  → { enabled, reason }
 */
(function (root) {
  "use strict";

  var ENDPOINT = "https://aibuilderlab.kr/api/demo/ai";
  var TIMEOUT_MS = 20000;
  var state = { enabled: null, reason: "", lastMs: 0, calls: 0, fallbacks: 0 };
  var listeners = [];

  function emit() {
    listeners.forEach(function (fn) { try { fn(status()); } catch (e) { /* 화면 갱신 실패는 무시 */ } });
  }

  function status() {
    return { enabled: state.enabled, reason: state.reason, lastMs: state.lastMs, calls: state.calls, fallbacks: state.fallbacks };
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("응답 시간 초과")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  /** 서버에 AI가 켜져 있는지 한 번 물어본다 */
  function probe() {
    if (typeof fetch !== "function") { state.enabled = false; state.reason = "fetch 없음"; emit(); return Promise.resolve(status()); }
    return withTimeout(fetch(ENDPOINT, { method: "GET" }), 6000)
      .then(function (r) { return r.json(); })
      .then(function (j) { state.enabled = !!j.enabled; state.reason = j.enabled ? "" : "AI 키 미설정"; })
      .catch(function () { state.enabled = false; state.reason = "서버에 연결할 수 없음"; })
      .then(function () { emit(); return status(); });
  }

  /** 작업 하나를 맡긴다. 실패하면 null */
  function ask(task, input) {
    if (state.enabled === false) { state.fallbacks++; emit(); return Promise.resolve(null); }
    var t0 = Date.now();
    return withTimeout(fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: task, input: input })
    }), TIMEOUT_MS)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          state.enabled = true; state.reason = ""; state.lastMs = j.ms || (Date.now() - t0); state.calls++;
          emit();
          return { data: j.data, ms: state.lastMs, model: j.model };
        }
        state.fallbacks++; state.reason = (j && j.reason) || "AI 응답 없음";
        if (state.reason === "AI 키 미설정") state.enabled = false;
        emit();
        return null;
      })
      .catch(function (e) {
        state.fallbacks++; state.reason = e && e.message ? e.message : "네트워크 오류";
        emit();
        return null;
      });
  }

  /** 상태가 바뀔 때마다 불린다 (화면의 'Claude로 분석 / 규칙 기반' 표시용) */
  function onChange(fn) { listeners.push(fn); fn(status()); }

  root.AI = { ask: ask, probe: probe, status: status, onChange: onChange, endpoint: ENDPOINT };
})(typeof window !== "undefined" ? window : globalThis);
