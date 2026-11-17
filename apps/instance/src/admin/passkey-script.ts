// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **`/admin/passkey.js`: the admin pages' one script** (#2642, ADR 0069 D-4),
 * served by the instance under `script-src 'self'` — no inline script, no
 * inline handler, no third-party code. It is held here as text, not read from
 * a file, so the portable core reads no file system (ADR 0037 D-2).
 *
 * What it does, and nothing else:
 *
 * - shows the passkey controls where `PublicKeyCredential` exists, and
 *   otherwise the sentence that says to sign in with a one-time code;
 * - **sign-in**: asks `/admin/sign-in/passkey-options` for a challenge, calls
 *   `navigator.credentials.get`, and submits the form with the assertion;
 * - **enrolment**: asks `/admin/passkeys/options`, calls
 *   `navigator.credentials.create`, and submits the form with the response;
 * - **step-up** (every form marked `data-step-up`): asks `/admin/step-up` for
 *   a challenge bound to the form's action and its fields, calls
 *   `navigator.credentials.get`, and submits the form with the assertion.
 *
 * With the script blocked every page still reads, and no change can be made:
 * the server refuses a form that carries no assertion. The browser gate
 * (`apps/web/browser/admin-passkeys.browser.spec.ts`) runs it against
 * Chromium's virtual authenticator.
 */
export const PASSKEY_SCRIPT = `'use strict';
(function () {
  var supported =
    typeof window.PublicKeyCredential === 'function' &&
    !!navigator.credentials &&
    typeof navigator.credentials.get === 'function';
  document.querySelectorAll('[data-passkey-unsupported]').forEach(function (node) {
    node.hidden = supported;
  });
  document.querySelectorAll('[data-passkey-supported]').forEach(function (node) {
    node.hidden = !supported;
  });
  if (!supported) return;

  function encode(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  function decode(text) {
    var padded = text.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4 !== 0) padded += '=';
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  function say(form, text) {
    var status = form.querySelector('[data-passkey-status]');
    if (status) status.textContent = text;
  }
  function fill(form, values) {
    Object.keys(values).forEach(function (name) {
      var input = form.querySelector('input[name="' + name + '"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        form.appendChild(input);
      }
      input.value = values[name];
    });
  }
  function fieldsOf(form) {
    var fields = {};
    new FormData(form).forEach(function (value, name) {
      if (typeof value === 'string') fields[name] = value;
    });
    return fields;
  }
  function post(path, fields) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    }).then(function (response) {
      if (!response.ok) throw new Error('refused');
      return response.json();
    });
  }
  function credentialsOf(ids) {
    return ids.map(function (id) {
      return { type: 'public-key', id: decode(id) };
    });
  }
  function assert(options) {
    return navigator.credentials.get({
      publicKey: {
        challenge: decode(options.challenge),
        rpId: options.rpId,
        allowCredentials: credentialsOf(options.allowCredentials),
        userVerification: 'required',
        timeout: options.timeout
      }
    }).then(function (credential) {
      return {
        credential: encode(credential.rawId),
        clientDataJSON: encode(credential.response.clientDataJSON),
        authenticatorData: encode(credential.response.authenticatorData),
        signature: encode(credential.response.signature)
      };
    });
  }
  function ceremony(form, run, failed) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      say(form, 'Waiting for your passkey…');
      run().then(function (values) {
        fill(form, values);
        form.submit();
      }, function () {
        say(form, failed);
      });
    });
  }

  var signIn = document.querySelector('form[data-passkey="sign-in"]');
  if (signIn) {
    ceremony(signIn, function () {
      return post('/admin/sign-in/passkey-options', {}).then(assert);
    }, 'The passkey sign-in did not finish. Try again, or sign in with a one-time code.');
  }

  var enrol = document.querySelector('form[data-passkey="enrol"]');
  if (enrol) {
    ceremony(enrol, function () {
      return post('/admin/passkeys/options', { csrf: fieldsOf(enrol).csrf }).then(function (options) {
        return navigator.credentials.create({
          publicKey: {
            challenge: decode(options.challenge),
            rp: { id: options.rpId, name: options.rpName },
            user: { id: decode(options.userHandle), name: 'owner', displayName: options.rpName },
            pubKeyCredParams: options.algorithms.map(function (alg) {
              return { type: 'public-key', alg: alg };
            }),
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
            attestation: 'none',
            excludeCredentials: credentialsOf(options.excludeCredentials),
            timeout: options.timeout
          }
        });
      }).then(function (credential) {
        return {
          clientDataJSON: encode(credential.response.clientDataJSON),
          attestationObject: encode(credential.response.attestationObject)
        };
      });
    }, 'The passkey was not added. Try again.');
  }

  document.querySelectorAll('form[data-step-up]').forEach(function (form) {
    ceremony(form, function () {
      var fields = fieldsOf(form);
      fields.action = form.getAttribute('data-step-up');
      return post('/admin/step-up', fields).then(assert);
    }, 'Nothing was changed: the passkey check did not finish. Try again.');
  });
})();
`;
