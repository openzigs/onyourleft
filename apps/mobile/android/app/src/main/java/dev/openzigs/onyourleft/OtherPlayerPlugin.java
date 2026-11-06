// SPDX-License-Identifier: AGPL-3.0-or-later

package dev.openzigs.onyourleft;

import android.content.Context;
import android.media.AudioManager;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Play, pause, next and previous for the rider's own music player, another app (#2073).
 *
 * <p>Spike 0034 and the owner's rulings of 2026-11-05 on it: controls only, with no permission and
 * no track title. {@link AudioManager#dispatchMediaKeyEvent} sends a simulated media key, which
 * Android routes the way it routes a headset button: on 8.0 and later to the last app whose media
 * session played audio locally, before 8.0 to the active session. Nothing here asks which app that
 * is, and nothing here can read what it is playing: no Notification access, no {@code
 * MediaSessionManager}.
 *
 * <p>Two methods and no state. {@code apps/mobile/src/other-player/other-player.ts} is the other
 * side of this bridge and {@code apps/web/src/shell/other-player.ts} decides when each is asked.
 *
 * <ul>
 *   <li>{@code sendKey({ key })} takes one of four names and nothing else: {@code play}, {@code
 *       pause}, {@code next}, {@code previous}. Any other value is refused before a key is sent,
 *       so a page cannot send an arbitrary key code through it (CLAUDE.md §6). The explicit play
 *       and pause keys rather than the toggle, by spike 0034 §1.2: the toggle could invert the
 *       rider's intent when we cannot see the player's state.
 *   <li>{@code otherAudioActive()} answers {@code { active }}, {@link AudioManager#isMusicActive}
 *       and nothing else. It counts this app's own sound too (spike 0034 §1.3), which the web side
 *       accounts for.
 * </ul>
 *
 * <p>⚠️ <b>Uncompiled.</b> CI does not build Android, the limit {@code apps/mobile/README.md} §4
 * records for the rest of this project. {@code apps/mobile/src/android/other-player-source.test.ts}
 * reads this source; whether each player obeys the keys is spike 0034 §7's device rows, proposed
 * for #733.
 */
@CapacitorPlugin(name = "OtherPlayer")
public class OtherPlayerPlugin extends Plugin {

    @PluginMethod
    public void sendKey(PluginCall call) {
        int keyCode = keyCodeFor(call.getString("key"));
        if (keyCode == 0) {
            call.reject("unknown media key");
            return;
        }
        AudioManager audio = audioManager();
        if (audio == null) {
            call.reject("no audio service");
            return;
        }
        audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
        audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
        call.resolve();
    }

    @PluginMethod
    public void otherAudioActive(PluginCall call) {
        AudioManager audio = audioManager();
        JSObject reply = new JSObject();
        reply.put("active", audio != null && audio.isMusicActive());
        call.resolve(reply);
    }

    /** The media key a name stands for, or 0 for any name that is not one of the four. */
    static int keyCodeFor(String key) {
        if ("play".equals(key)) {
            return KeyEvent.KEYCODE_MEDIA_PLAY;
        }
        if ("pause".equals(key)) {
            return KeyEvent.KEYCODE_MEDIA_PAUSE;
        }
        if ("next".equals(key)) {
            return KeyEvent.KEYCODE_MEDIA_NEXT;
        }
        if ("previous".equals(key)) {
            return KeyEvent.KEYCODE_MEDIA_PREVIOUS;
        }
        return 0;
    }

    private AudioManager audioManager() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }
}
