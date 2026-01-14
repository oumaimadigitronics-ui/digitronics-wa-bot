/**
 * Audio error message classification and localization.
 * Provides specific, helpful error messages for audio transcription failures.
 */

/**
 * Get localized error message for audio transcription failure.
 * @param {string} errorType - Type of error (quota_exceeded, audio_too_short, etc.)
 * @param {string} lang - Language code (dz, ar, fr, en)
 * @returns {string} Localized error message
 */
export function getAudioErrorMessage(errorType, lang = 'dz') {
  const messages = {
    quota_exceeded: {
      dz: "3ndna mochkil technique daba, 3awed mn ba3d aw kteb l-message 🙏",
      ar: "عندنا مشكل تقني دابا، عاود من بعد أو كتب الرسالة 🙏",
      fr: "Problème technique momentané, réessayez plus tard ou écrivez votre message 🙏",
      en: "Technical issue right now, please try again later or type your message 🙏"
    },
    audio_too_short: {
      dz: "L-voice 9sir bzzaf, 3awed sejel message twal chwiya (5 seconds minimum) 🎤",
      ar: "الصوت قصير بزاف، عاود سجل رسالة طويلة شوية 🎤",
      fr: "Message trop court, enregistrez au moins 5 secondes 🎤",
      en: "Voice message too short, please record at least 5 seconds 🎤"
    },
    audio_too_long: {
      dz: "L-voice twil bzzaf (max 5 min), 9ssmo l messages sghar 🎤",
      ar: "الصوت طويل بزاف، قسمو لرسائل صغار 🎤",
      fr: "Message trop long (max 5 min), divisez-le en plusieurs parties 🎤",
      en: "Voice message too long (max 5 min), please split into smaller parts 🎤"
    },
    poor_quality: {
      dz: "Ma sme3tch mezyan, 3awed sejel f blasa hada bla souda3 🔇",
      ar: "ما سمعتش مزيان، عاود سجل في بلاصة هادئة 🔇",
      fr: "Audio pas clair, réenregistrez dans un endroit calme 🔇",
      en: "Couldn't hear clearly, please re-record in a quiet place 🔇"
    },
    network_error: {
      dz: "Ma9drnach n7amlo l-audio, 3awed sifto 📶",
      ar: "ماقدرناش نحملو الصوت، عاود صيفطو 📶",
      fr: "Impossible de télécharger l'audio, renvoyez-le 📶",
      en: "Couldn't download audio, please resend 📶"
    },
    unsupported_format: {
      dz: "Had l-format ma supportinach, sifet voice note 3adi 🎤",
      ar: "هاد الفورما ما سوبورتيناش، صيفط voice note عادي 🎤",
      fr: "Format non supporté, envoyez une note vocale standard 🎤",
      en: "Unsupported format, please send a standard voice note 🎤"
    },
    transcription_failed: {
      dz: "Ma fhemtch l-audio, 3awed sejel b woudou7 aw kteb 🙏",
      ar: "ما فهمتش الصوت، عاود سجل بوضوح أو كتب 🙏",
      fr: "Impossible de comprendre l'audio, réenregistrez clairement ou écrivez 🙏",
      en: "Couldn't understand the audio, please re-record clearly or type 🙏"
    }
  };

  return messages[errorType]?.[lang] || messages[errorType]?.dz || messages.transcription_failed[lang] || messages.transcription_failed.dz;
}

/**
 * Classify audio error based on error message or object.
 * @param {Error|string|Object} error - Error object, message, or error details
 * @returns {string} Error type classification
 */
export function classifyAudioError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  
  // Check for quota/rate limit errors
  if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit')) {
    return 'quota_exceeded';
  }
  
  // Check for duration-related errors
  if (msg.includes('too_short') || msg.includes('audio_short') || msg.includes('duration') && msg.includes('short')) {
    return 'audio_too_short';
  }
  
  if (msg.includes('too_long') || msg.includes('audio_long') || msg.includes('size') && msg.includes('large')) {
    return 'audio_too_long';
  }
  
  // Check for quality issues
  if (msg.includes('quality') || msg.includes('unclear') || msg.includes('noise')) {
    return 'poor_quality';
  }
  
  // Check for network errors
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('download') || msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return 'network_error';
  }
  
  // Check for format errors
  if (msg.includes('format') || msg.includes('codec') || msg.includes('unsupported')) {
    return 'unsupported_format';
  }
  
  // Default: generic transcription failure
  return 'transcription_failed';
}
