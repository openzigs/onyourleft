// SPDX-License-Identifier: Apache-2.0

/**
 * The published test vectors HPKE is gated on (#1188, ADR 0047 D-3). Test
 * support, never shipped.
 *
 * These are the RFCs' own numbers, copied from the text of each RFC as the
 * RFC Editor publishes it (https://www.rfc-editor.org/rfc/rfc9180.txt and
 * https://www.rfc-editor.org/rfc/rfc9458.txt, read 2026-10-08), with the hex
 * the RFC wraps across lines joined. Facts, not anybody's implementation: no
 * HPKE library's code or vector file was read.
 */

/** One listed encryption of RFC 9180 A.1.1.1. */
export interface Rfc9180Encryption {
  readonly sequence: number;
  readonly pt: string;
  readonly aad: string;
  readonly nonce: string;
  readonly ct: string;
}

/** One listed export of RFC 9180 A.1.1.2. */
export interface Rfc9180Export {
  readonly exporterContext: string;
  readonly length: number;
  readonly exportedValue: string;
}

/**
 * RFC 9180 **Appendix A.1.1, "Base Setup Information"**, with A.1.1.1
 * (Encryptions) and A.1.1.2 (Exported Values): DHKEM(X25519, HKDF-SHA256),
 * HKDF-SHA256, AES-128-GCM, `mode_base`.
 */
export const RFC_9180_A_1_BASE = {
  mode: 0,
  kemId: 32,
  kdfId: 1,
  aeadId: 1,
  info: '4f6465206f6e2061204772656369616e2055726e',
  pkEm: '37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431',
  skEm: '52c4a758a802cd8b936eceea314432798d5baf2d7e9235dc084ab1b9cfa2f736',
  pkRm: '3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d',
  skRm: '4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8',
  enc: '37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431',
  sharedSecret: 'fe0e18c9f024ce43799ae393c7e8fe8fce9d218875e8227b0187c04e7d2ea1fc',
  keyScheduleContext:
    '00725611c9d98c07c03f60095cd32d400d8347d45ed67097bbad50fc56da742d07cb6cffde367bb0565ba28bb02c90744a20f5ef37f30523526106f637abb05449',
  secret: '12fff91991e93b48de37e7daddb52981084bd8aa64289c3788471d9a9712f397',
  key: '4531685d41d65f03dc48f6b8302c05b0',
  baseNonce: '56d890e5accaaf011cff4b7d',
  exporterSecret: '45ff1c2e220db587171952c0592d5f5ebe103f1561a2614e38f2ffd47e99e3f8',
  encryptions: [
    {
      sequence: 0,
      pt: '4265617574792069732074727574682c20747275746820626561757479',
      aad: '436f756e742d30',
      nonce: '56d890e5accaaf011cff4b7d',
      ct: 'f938558b5d72f1a23810b4be2ab4f84331acc02fc97babc53a52ae8218a355a96d8770ac83d07bea87e13c512a',
    },
    {
      sequence: 1,
      pt: '4265617574792069732074727574682c20747275746820626561757479',
      aad: '436f756e742d31',
      nonce: '56d890e5accaaf011cff4b7c',
      ct: 'af2d7e9ac9ae7e270f46ba1f975be53c09f8d875bdc8535458c2494e8a6eab251c03d0c22a56b8ca42c2063b84',
    },
    {
      sequence: 2,
      pt: '4265617574792069732074727574682c20747275746820626561757479',
      aad: '436f756e742d32',
      nonce: '56d890e5accaaf011cff4b7f',
      ct: '498dfcabd92e8acedc281e85af1cb4e3e31c7dc394a1ca20e173cb72516491588d96a19ad4a683518973dcc180',
    },
    {
      sequence: 4,
      pt: '4265617574792069732074727574682c20747275746820626561757479',
      aad: '436f756e742d34',
      nonce: '56d890e5accaaf011cff4b79',
      ct: '583bd32bc67a5994bb8ceaca813d369bca7b2a42408cddef5e22f880b631215a09fc0012bc69fccaa251c0246d',
    },
    {
      sequence: 255,
      pt: '4265617574792069732074727574682c20747275746820626561757479',
      aad: '436f756e742d323535',
      nonce: '56d890e5accaaf011cff4b82',
      ct: '7175db9717964058640a3a11fb9007941a5d1757fda1a6935c805c21af32505bf106deefec4a49ac38d71c9e0a',
    },
    {
      sequence: 256,
      pt: '4265617574792069732074727574682c20747275746820626561757479',
      aad: '436f756e742d323536',
      nonce: '56d890e5accaaf011cff4a7d',
      ct: '957f9800542b0b8891badb026d79cc54597cb2d225b54c00c5238c25d05c30e3fbeda97d2e0e1aba483a2df9f2',
    },
  ] satisfies readonly Rfc9180Encryption[],
  exports: [
    {
      exporterContext: '',
      length: 32,
      exportedValue: '3853fe2b4035195a573ffc53856e77058e15d9ea064de3e59f4961d0095250ee',
    },
    {
      exporterContext: '00',
      length: 32,
      exportedValue: '2e8f0b54673c7029649d4eb9d5e33bf1872cf76d623ff164ac185da9e88c21a5',
    },
    {
      exporterContext: '54657374436f6e74657874',
      length: 32,
      exportedValue: 'e9e43065102c3836401bed8c3c3c75ae46be1639869391d62c61f1ec7af54931',
    },
  ] satisfies readonly Rfc9180Export[],
} as const;

/**
 * RFC 9458 **Appendix A, "Complete Example of a Request and Response"** — the
 * same HPKE suite, and the response derivation ADR 0047 D-2 adopts with the
 * label `"message/bhttp response"` in place of `"oyl response v1"`. The
 * request header RFC 9458 §4.3 puts in `info` is already inside `info` and
 * `encapsulatedRequest` as the RFC prints them; the request's AAD is empty.
 */
export const RFC_9458_APPENDIX_A = {
  skR: '3c168975674b2fa8e465970b79c8dcf09f1c741626480bd4c6162fc5b6a98e1a',
  /** The key configuration: key id, KEM id, then `pkR` at bytes 3 to 35. */
  keyConfiguration:
    '01002031e1f05a740102115220e9af918f738674aec95f54db6e04eb705aae8e79815500080001000100010003',
  request: '00034745540568747470730b6578616d706c652e636f6d012f',
  skE: 'bc51d5e930bda26589890ac7032f70ad12e4ecb37abb1b65b1256c9c48999c73',
  pkE: '4b28f881333e7c164ffc499ad9796f877f4e1051ee6d31bad19dec96c208b472',
  info: '6d6573736167652f626874747020726571756573740001002000010001',
  /** `hdr (7 bytes) || enc (32) || ct`. */
  encapsulatedRequest:
    '010020000100014b28f881333e7c164ffc499ad9796f877f4e1051ee6d31bad19dec96c208b4726374e469135906992e1268c594d2a10c695d858c40a026e7965e7d86b83dd440b2c0185204b4d63525',
  response: '0140c8',
  responseLabel: 'message/bhttp response',
  exportedSecret: '62d87a6ba569ee81014c2641f52bea36',
  responseNonce: 'c789e7151fcba46158ca84b04464910d',
  key: '5d0172a080e428b16d298c4ea0db620d',
  nonce: 'f6bf1aeb88d6df87007fa263',
  /** `response_nonce || ct`. */
  encapsulatedResponse: 'c789e7151fcba46158ca84b04464910d86f9013e404feea014e7be4a441f234f857fbd',
} as const;
