/**
 * Internationalization (i18n) Module
 * 
 * Provides multilingual translation functionality for the WhatsApp bot.
 * Supports Darija (dzl), French (fr), Arabic (ar), and English (en).
 */

/**
 * CONTACTS constant - Phone numbers and WhatsApp contact information
 */
export const CONTACTS = {
  whatsapp: "0660111438",
  calls: ["0660111438"],
};

/**
 * Main translation function
 * 
 * @param {string} lang - Language code ('dzl', 'fr', 'ar', 'en')
 * @param {string} key - Translation key
 * @param {Object} vars - Variables to interpolate into the translation
 * @param {Object} options - Additional options (COMPANY, ORDER_FORM_URL_SAFE, MAPS_URL_SAFE, formatSize)
 * @returns {string} Translated string
 * 
 * @example
 * t('fr', 'address', {}, { COMPANY: { address: '...' } })
 * t('dzl', 'notAvailableSize', { brand: 'Samsung', size: '50' }, { formatSize })
 */
export function t(lang, key, vars, options = {}) {
  const L = lang || "dzl";
  const v = vars || {};
  const { 
    COMPANY = { address: "", name: "Digitronics" },
    ORDER_FORM_URL_SAFE = "",
    MAPS_URL_SAFE = "",
    formatSize = (l, s) => s + '"'
  } = options;

  const dict = {
    dzl: {
      askTextInsteadMedia: "Smah lia, ma nqdrch nfhem l-content mn image/voice. 3afak kteb l-message b text bach n3awnk.",
      typeYourMessage: "3afak kteb l-message dyalk.",
      address: "L3nwan dyalna: " + COMPANY.address,
      orderForm: "Tfdal/ي: 3mmer had formulaire bach tdir commande: " + ORDER_FORM_URL_SAFE,
      orderHumanHandoff: "Wakil bashari ghadi ykml m3ak bach ytba3 l-commande. Ila bghiti tsift chi haja wala t3ayet: " + CONTACTS.calls.join(" / ") + ".",
      askOrderNo: "3afak sft رقم الطلب bach n9dro n7ssbo.",
      gotOrderNo: "Shokran. Tsslna b رقم الطلب. Ghadi n3yto lik قريب.",
      callSoon: "Mzyan. Ghadi n3yto lik قريب.",
      callSoonNeedOrder: "Mzyan. Ghadi n3yto lik قريب. Ila 3ndk رقم الطلب sftih lina 3afak.",
      bankTransferHow:
        'Ila bghiti tخلص b virement: mlli tdir commande, zid note f formulaire: "paiement par virement bancaire".\nFormulaire: ' +
        ORDER_FORM_URL_SAFE,
      needDetails:
        "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
        CONTACTS.calls.join(" / ") +
        ".",
      cannot3: "Ma qdrtch n3tik jawab bd9a daba. T9dr t3yt lina: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "produit").trim();
        return `Hna l-produit ${name}: ${link}`;
      },
      photoClosest: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "produit").trim();
        return `Hadi qrab 7aja l talabt: ${name} - ${link}`;
      },
      photoNoLink: "Ma 3ndnach link dyal tswira daba. 3tini model wla brand+size.",
      askBrandModelSize:
        "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
        CONTACTS.calls.join(" / ") +
        ".",
      categoryUnavailable: (x) => {
        const z = x || {};
        const category = String(z.category || "");
        return "Smah lia, ma kaynch chi offre f " + category + " daba.";
      },
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        const sizeTxt = formatSize("dzl", size);
        return "Smah lia, ma kaynach " + brand + " " + sizeTxt + " daba.";
      },
      notAvailableSizeGeneral: (x) => {
        const z = x || {};
        const size = String(z.size || "");
        const sizeTxt = formatSize("dzl", size);
        return "Smah lia, ma kaynach TV " + sizeTxt + " daba.";
      },
      askBrandForSize: (x) => {
        void x;
        return (
          "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
          CONTACTS.calls.join(" / ") +
          "."
        );
      },
      preferBest: "L'a7san men had l-khtiyarat هو",
      preferCheapest: "L'ar5as men had l-khtiyarat هو",
      preferNeedContext: "Sift size (b7al tv 50) wla model bach nختار l'a7san wla l'ar5as.",
      iptvCall: "IPTV kayn f service. 3afak 3ayet " + CONTACTS.calls.join(" / ") + ".",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL, Haier, Samsung");
        return "Smah lia, ma kanso9osh Xiaomi. 3andna options 7sen b " + brands + ". Hna chi offres:";
      },
      CONTACT_DETAILS:
        "📍 L3nwan: " +
        COMPANY.address +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp +
        "\n📞 T3ayet lina: " +
        CONTACTS.calls.join(" / ") +
        "\n🗺️ Maps: " +
        MAPS_URL_SAFE,
      OPENING_HOURS: "🕒 Lkhadma: Lundi–Samedi 10:00–19:00.",
      DELIVERY_INFO: "🚚 Livraison f Maroc كامل: 24–72h حسب l-mdina.\n✅ COD (cash f livraison) kayn.",
      WARRANTY_INFO: (x) => {
        if (x && x.daikoTv) return "🛡️ Garantie: 2 ans (TV DAIKO).";
        return "🛡️ Garantie standard: 1 an. Exception: TV DAIKO = 2 ans.";
      },
      SUPPORT_PROBLEM:
        "🙏 Smah lina 3la l-mochkil. Ghadi n3tih أولوية و nتابع m3ak حتى l-حل.\n📞 Support: " +
        CONTACTS.calls.join(" / ") +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp,
    },
    fr: {
      askTextInsteadMedia: "Merci. Pour que je comprenne, envoyez un message écrit (sans audio/image).",
      typeYourMessage: "Merci d'écrire votre demande.",
      address: "Notre adresse: " + COMPANY.address,
      orderForm: "Veuillez remplir ce formulaire pour commander: " + ORDER_FORM_URL_SAFE,
      orderHumanHandoff: "Un agent humain va reprendre la conversation pour vérifier votre commande. Vous pouvez aussi appeler: " + CONTACTS.calls.join(" / ") + ".",
      askOrderNo: "Merci d'envoyer votre numéro de commande pour vérification.",
      gotOrderNo: "Merci. Nous avons bien reçu votre numéro de commande. Nous vous appellerons bientôt.",
      callSoon: "D'accord. Nous vous appellerons bientôt.",
      callSoonNeedOrder: "D'accord. Nous vous appellerons bientôt. Si vous avez un numéro de commande, envoyez-le.",
      bankTransferHow:
        'Paiement par virement : lors de la commande, ajoutez une note dans le formulaire : "paiement par virement bancaire".\nFormulaire: ' +
        ORDER_FORM_URL_SAFE,
      needDetails:
        "Désolé, je n'ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au " +
        CONTACTS.calls.join(" / ") +
        ".",
      cannot3: "Je ne peux pas répondre avec certitude pour le moment. Vous pouvez appeler: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "produit").trim();
        return `Voici le produit ${name}: ${link}`;
      },
      photoClosest: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "produit").trim();
        return `C'est le produit le plus proche de votre demande: ${name} - ${link}`;
      },
      photoNoLink: "Je n'ai pas de lien photo pour ce produit. Précisez le modèle ou marque+taille.",
      askBrandModelSize:
        "Désolé, je n'ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au " +
        CONTACTS.calls.join(" / ") +
        ".",
      categoryUnavailable: (x) => {
        const z = x || {};
        const category = String(z.category || "");
        return "Désolé, aucune offre disponible pour " + category + " maintenant.";
      },
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        const sizeTxt = formatSize("fr", size);
        return "Désolé, je n'ai pas " + brand + " " + sizeTxt + " pour le moment.";
      },
      notAvailableSizeGeneral: (x) => {
        const z = x || {};
        const size = String(z.size || "");
        const sizeTxt = formatSize("fr", size);
        return "Désolé, aucune TV " + sizeTxt + " disponible pour le moment.";
      },
      askBrandForSize: (x) => {
        void x;
        return (
          "Désolé, je n'ai pas bien compris 🙏 Un agent humain va prendre le relais, ou appelez-nous au " +
          CONTACTS.calls.join(" / ") +
          "."
        );
      },
      preferBest: "Le meilleur parmi ces options est",
      preferCheapest: "Le moins cher parmi ces options est",
      preferNeedContext: "Envoyez la taille (ex tv 50) ou le modèle pour choisir le meilleur ou le moins cher.",
      iptvCall: "Service IPTV disponible. Veuillez appeler " + CONTACTS.calls.join(" / ") + ".",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL, Haier et Samsung");
        return "Désolé, nous ne vendons pas Xiaomi. Nous avons de meilleures options comme " + brands + ". Voici des offres dispo:";
      },
      CONTACT_DETAILS:
        "📍 Adresse: " +
        COMPANY.address +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp +
        "\n📞 Appels: " +
        CONTACTS.calls.join(" / ") +
        "\n🗺️ Maps: " +
        MAPS_URL_SAFE,
      OPENING_HOURS: "🕒 Horaires: Lun–Sam 10:00–19:00.",
      DELIVERY_INFO: "🚚 Livraison partout au Maroc: 24–72h selon la ville.\n✅ Paiement à la livraison (COD).",
      WARRANTY_INFO: (x) => {
        if (x && x.daikoTv) return "🛡️ Garantie: 2 ans (TV DAIKO).";
        return "🛡️ Garantie standard: 1 an. Exception: TV DAIKO = 2 ans.";
      },
      SUPPORT_PROBLEM:
        "🙏 Désolé pour le problème. Nous traitons votre demande en priorité et jusqu'à résolution.\n📞 Support: " +
        CONTACTS.calls.join(" / ") +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp,
    },
    ar: {
      askTextInsteadMedia: "شكراً. من فضلك ارسل رسالة مكتوبة (بدون صوت/صورة) باش نقدر نفهمك.",
      typeYourMessage: "من فضلك اكتب رسالتك.",
      address: "عنواننا: " + COMPANY.address,
      orderForm: "من فضلك عبّئ هذا الفورم للطلب: " + ORDER_FORM_URL_SAFE,
      orderHumanHandoff: "غادي يدخل وكيل بشري باش يتبع معاك حالة الطلب. تقدر حتى تعيط لينا: " + CONTACTS.calls.join(" / ") + ".",
      askOrderNo: "من فضلك ارسل رقم الطلب باش نقدر نتحققو.",
      gotOrderNo: "شكراً. توصلنا برقم الطلب. غادي نعيطو ليك قريب.",
      callSoon: "حسناً. غادي نعيطو ليك قريب.",
      callSoonNeedOrder: "حسناً. غادي نعيطو ليك قريب. إلا كان عندك رقم الطلب صيفطو من فضلك.",
      bankTransferHow:
        'باش تخلص بالتحويل البنكي: منين دير الطلب زيد ملاحظة فالفورم: "الدفع بتحويل بنكي".\nالفورم: ' + ORDER_FORM_URL_SAFE,
      needDetails:
        "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
        CONTACTS.calls.join(" / ") +
        ".",
      cannot3: "ماقدرتش نعطيك جواب مؤكد دابا. تقدر تعيط لينا: " + CONTACTS.calls.join(" / ") + ".",
      photoLink: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "المنتوج").trim();
        return `ها هو المنتوج ${name}: ${link}`;
      },
      photoClosest: (x) => {
        const link = String((x || {}).link || "");
        const name = String((x || {}).name || "المنتوج").trim();
        return `ها أقرب منتوج لطلبك: ${name} - ${link}`;
      },
      photoNoLink: "ما كاينش رابط صورة لهاد المنتج دابا. عطيني الموديل ولا الماركة+الحجم.",
      askBrandModelSize:
        "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
        CONTACTS.calls.join(" / ") +
        ".",
      categoryUnavailable: (x) => {
        const z = x || {};
        const category = String(z.category || "");
        return "سمح ليا، ما كايناش عروض ديال " + category + " دابا.";
      },
      notAvailableSize: (x) => {
        const z = x || {};
        const brand = String(z.brand || "");
        const size = String(z.size || "");
        const sizeTxt = formatSize("ar", size);
        return "سمح ليا، ما كايناش " + brand + " " + sizeTxt + " دابا.";
      },
      notAvailableSizeGeneral: (x) => {
        const z = x || {};
        const size = String(z.size || "");
        const sizeTxt = formatSize("ar", size);
        return "سمح ليا، ما كايناش تلفاز " + sizeTxt + " دابا.";
      },
      askBrandForSize: (x) => {
        void x;
        return (
          "سمح ليا ما فهمتش الطلب ديالك مزيان 🙏 غادي يدخل معاك وكيل بشري يكمل معاك، ولا تقدر تعيط لينا على " +
          CONTACTS.calls.join(" / ") +
          "."
        );
      },
      preferBest: "الأفضل من هاد الخيارات هو",
      preferCheapest: "الأرخص من هاد الخيارات هو",
      preferNeedContext: "صيفط الحجم (مثلاً tv 50) ولا الموديل باش نختار الأفضل ولا الأرخص.",
      iptvCall: "خدمة IPTV متوفرة. اتصل على " + CONTACTS.calls.join(" / ") + ".",
      xiaomiRedirect: (x) => {
        const brands = String((x || {}).brands || "TCL و Haier و Samsung");
        return "سمح ليا، ما كنبيعوش Xiaomi. عندنا اختيارات أحسن بحال " + brands + ". هاهي بعض العروض:";
      },
      CONTACT_DETAILS:
        "📍 العنوان: " +
        COMPANY.address +
        "\n📲 واتساب: " +
        CONTACTS.whatsapp +
        "\n📞 مكالمات: " +
        CONTACTS.calls.join(" / ") +
        "\n🗺️ Maps: " +
        MAPS_URL_SAFE,
      OPENING_HOURS: "🕒 أوقات العمل: الإثنين–السبت 10:00–19:00.",
      DELIVERY_INFO: "🚚 التوصيل فالمغرب كامل: 24–72 ساعة حسب المدينة.\n✅ الدفع عند الاستلام (COD).",
      WARRANTY_INFO: (x) => {
        if (x && x.daikoTv) return "🛡️ الضمان: سنتين (تلفاز DAIKO).";
        return "🛡️ الضمان القياسي: سنة واحدة. استثناء: تلفاز DAIKO سنتين.";
      },
      SUPPORT_PROBLEM:
        "🙏 كنعتذرو على المشكل. غادي نعطيوه أولوية ونبقاو متابعين حتى يتحل.\n📞 الدعم: " +
        CONTACTS.calls.join(" / ") +
        "\n📲 واتساب: " +
        CONTACTS.whatsapp,
    },
    en: {
      CONTACT_DETAILS:
        "📍 Address: " +
        COMPANY.address +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp +
        "\n📞 Calls: " +
        CONTACTS.calls.join(" / ") +
        "\n🗺️ Maps: " +
        MAPS_URL_SAFE,
      OPENING_HOURS: "🕒 Hours: Mon–Sat 10:00–19:00.",
      DELIVERY_INFO: "🚚 Delivery across Morocco: 24–72h by city.\n✅ Cash on delivery (COD) available.",
      WARRANTY_INFO: (x) => {
        if (x && x.daikoTv) return "🛡️ Warranty: 2 years (DAIKO TV).";
        return "🛡️ Standard warranty: 1 year. Exception: DAIKO TVs = 2 years.";
      },
      SUPPORT_PROBLEM:
        "🙏 Sorry for the issue. We are prioritizing it and will follow up until resolved.\n📞 Support: " +
        CONTACTS.calls.join(" / ") +
        "\n📲 WhatsApp: " +
        CONTACTS.whatsapp,
    },
  };

  const base = dict[L] || dict.dzl;
  const val = base[key] ?? dict.dzl[key];
  if (typeof val === "function") return String(val(v));
  return String(val || "");
}
