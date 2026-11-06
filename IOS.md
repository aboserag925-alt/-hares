# تطبيق iOS — استراحة أهل الأثر

يعتمد تطبيق iOS على واجهة الويب الموجودة في `app/` باستخدام Capacitor، مع الحفاظ على وظائف التطبيق الحالية واتجاه RTL.

## بناء نسخة اختبار للمحاكي

1. افتح GitHub Actions.
2. اختر **iOS app build** ثم **Run workflow**.
3. بعد نجاح البناء، نزّل artifact باسم `ahl-athar-ios-simulator`.
4. هذه نسخة لمحاكي iOS وليست ملف IPA صالحًا للنشر على App Store أو للتثبيت المباشر على iPhone.

## النشر العام عبر App Store

يتطلب إصدار App Store:
- عضوية Apple Developer Program سارية.
- Bundle ID نهائيًا وفريدًا، ويفضل تثبيته قبل أول إصدار.
- إعداد التوقيع والتوزيع (Apple Distribution certificate وApp Store provisioning profile) داخل بيئة بناء macOS آمنة.
- إعداد App Store Connect وبيانات الخصوصية ولقطات الشاشة ومعلومات التطبيق.
- بناء Archive موقّع ثم رفعه إلى App Store Connect واختباره عبر TestFlight قبل الإرسال لمراجعة Apple.

لا تضع شهادات التوقيع أو ملفات provisioning أو كلمات مرورها في المستودع. ولا تعتبر نسخة المحاكي إصدارًا منشورًا.

## إعدادات التطبيق

يجب ضبط متغيرات GitHub Actions التالية:
- `AHL_SUPABASE_URL`
- `AHL_SUPABASE_ANON_KEY`
- `AHL_API_BASE_URL` (إذا كانت واجهة API مستضافة)

مفتاح Supabase anon/publishable مخصص للعميل؛ أما service-role وأسرار Gemini/Grok وTelegram فتبقى على الخادم ولا تدخل تطبيق iOS.
