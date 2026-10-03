-- ALLURE Boutique — add Arabic text to an existing store.
-- Run in Supabase → SQL Editor AFTER running the latest schema.sql. Safe to run more than once:
-- it only fills Arabic fields that are still empty and never changes anything you've edited.

update public.products p set
  name_ar        = case when p.name_ar = '' then v.name_ar else p.name_ar end,
  description_ar = case when p.description_ar = '' then v.description_ar else p.description_ar end,
  material_ar    = case when p.material_ar = '' then v.material_ar else p.material_ar end,
  size_ar        = case when p.size_ar = '' then v.size_ar else p.size_ar end,
  color_ar       = case when p.color_ar = '' then v.color_ar else p.color_ar end,
  comes_with_ar  = case when cardinality(p.comes_with_ar) = 0 then v.comes_with_ar else p.comes_with_ar end
from (values
  ('cairo', 'قلادة كايرو', 'سلسلة مجدولة ناعمة تلمع مع كل حركة. ارتديها وحدها أو مع قطع أخرى.', 'نحاس مطلي بالذهب', '45 سم + 5 سم وصلة', 'ذهبي', array['علبة هدية']::text[]),
  ('initial', 'قلادة الحرف الأول', 'حرفك في قلادة مصقولة برقة — قطعة شخصية تُرتدى كل يوم.', 'ستانلس ستيل مطلي بالذهب', '42 سم', 'ذهبي', array['علبة هدية']::text[]),
  ('tennis', 'سوار ريفييرا تنس', 'صف متصل من الأحجار اللامعة في سوار نحيف ومرن.', 'فضة مطلية بالذهب · زركون', '17 سم', 'ذهبي', array['علبة هدية','قطعة تلميع']::text[]),
  ('serpent-bangle', 'إسورة الأفعى', 'أفعى منحوتة تلتف حول المعصم — جريئة، أنيقة وهادئة القوة.', 'نحاس مطلي بالذهب', 'مقاس حر', 'ذهبي', array['علبة هدية']::text[]),
  ('lumiere', 'خاتم لوميير سوليتير', 'حجر لامع في المنتصف على خاتم رفيع من ذهب عيار 18. هادئ وخالد، صُنع ليُرتدى للأبد.', 'ذهب عيار 18 · ألماس', 'مقاسات 16–19', 'ذهب أصفر', array['شهادة','علبة هدية']::text[]),
  ('trio', 'ثلاثية الخواتم', 'ثلاثة خواتم رفيعة تُرتدى معاً أو منفصلة كما تحبين.', 'فضة مطلية بالذهب', 'مقاسات 17–19', 'ذهبي', array['علبة هدية']::text[]),
  ('sable', 'حلق سابل الدائري', 'حلق دائري متوسط بتصميم منحوت ووزن مريح. الفخامة اليومية التي لا تخلعينها.', 'مطلي بذهب عيار 18', 'دائرة 3 سم', 'ذهبي', array['علبة هدية']::text[]),
  ('pearl-set', 'طقم حلق اللؤلؤ', 'ثلاثة أزواج من حلق اللؤلؤ، من الحلق الصغير إلى حلق السهرة.', 'لؤلؤ طبيعي · مطلي بالذهب', '3 أزواج', 'ذهبي / لؤلؤي', array['علبة هدية']::text[]),
  ('anklet', 'خلخال السلسلة الرقيق', 'سلسلة رفيعة جداً مع تعليقة صغيرة — للصيف وما بعده.', 'ستانلس ستيل مطلي بالذهب', '23 سم + 4 سم وصلة', 'ذهبي', array['كيس']::text[]),
  ('soleil-set', 'طقم سوليه', 'نقشة الشمس على أربع قطع. اختاري الطقم كاملاً أو القطع التي تحبينها فقط — لكل قطعة سعرها.', 'نحاس مطلي بالذهب · زركون', 'القلادة 45 سم · الخاتم مقاسات 17–19', 'ذهبي', array['علبة هدية']::text[]),
  ('aurelie', 'شنطة أوريلي كتف', 'شنطة كتف هلالية من الشامواه الناعم بطول مثالي.', 'جلد شامواه', '20 × 12 سم', 'جملي', array['كيس قماش']::text[]),
  ('mayfair', 'شنطة مايفير مونوغرام', 'شنطة يومية متماسكة بقفل ذهبي مصقول. واسعة لليوم، وأنيقة للمساء.', 'كانفاس مطلي · أطراف جلد', '20 × 40 سم', 'عنابي', array['3 أحزمة','علبة وكيس قماش']::text[]),
  ('luna', 'شنطة لونا كروس', 'شنطة كروس صغيرة بغطاء منحني — عملية وأنيقة.', 'جلد طبيعي', '18 × 12 سم', 'أسود', array['حزام قابل للتعديل','كيس قماش']::text[]),
  ('etoile', 'كلاتش إيتوال للسهرة', 'كلاتش ساتان ناعم بقفل مرصع، مصمم للسهرات.', 'ساتان · قفل كريستال', '22 × 11 سم', 'شامبين', array['سلسلة كتف','كيس قماش']::text[]),
  ('milano', 'محفظة ميلانو بسحاب', 'محفظة بسحاب كامل واثنتي عشرة خانة للكروت ومقبض ذهبي.', 'جلد سافيانو', '19 × 10 سم', 'أسود', array['علبة']::text[]),
  ('riviera', 'نظارة ريفييرا كات آي', 'إطار أسيتات مصقول يدوياً بتصميم كات آي، وعدسات متدرجة بحماية كاملة من الأشعة.', 'أسيتات تورتواز', 'عدسة 54 مم', 'تورتواز', array['جراب','قطعة تنظيف']::text[]),
  ('noir', 'نظارة نوار أفياتور', 'الأفياتور الكلاسيكية بإطار ذهبي مطفي وعدسات دخانية.', 'إطار معدني', 'عدسة 58 مم', 'ذهبي / دخاني', array['جراب','قطعة تنظيف']::text[]),
  ('capri', 'نظارة كابري البيضاوية', 'إطار بيضاوي نحيف بعدسات ملونة بنعومة.', 'إطار معدني', 'عدسة 50 مم', 'روز', array['جراب']::text[]),
  ('heritage', 'ساعة هيريتاج أوتوماتيك', 'ساعة أوتوماتيك 36 مم بمينا داكنة وعلامات ذهبية. حرفية ميكانيكية لكل مناسبة.', 'ستانلس ستيل · لون ذهبي', 'قطر 36 مم', 'ذهبي · مينا سوداء', array['علبة','كارت ضمان']::text[]),
  ('serpenti', 'ساعة الأفعى الملتفة', 'ساعة سوار تلتف حول المعصم مرتين — مجوهرات تعرف الوقت.', 'ستيل مطلي بالذهب', 'مقاس حر', 'ذهبي', array['علبة']::text[])
) as v(id, name_ar, description_ar, material_ar, size_ar, color_ar, comes_with_ar)
where p.id = v.id;

update public.settings s set data = s.data
  || jsonb_build_object('promo', '{"kicker_ar":"تخفيضات الموسم · لفترة محدودة","small_ar":"خصم","title_ar":"البلاك فرايداي","text_ar":"أكبر تشكيلة في السنة — شنط ومجوهرات ونظارات وساعات مختارة بعناية بخصم يصل إلى النصف.","cta_ar":"تسوقي التخفيضات"}'::jsonb || coalesce(s.data->'promo', '{}'::jsonb))
  || jsonb_build_object('address_ar', coalesce(nullif(s.data->>'address_ar', ''), 'فاليو 2 مول، القاهرة الجديدة، القاهرة'),
                        'hours_ar',   coalesce(nullif(s.data->>'hours_ar', ''), 'يومياً · 12:00 ظهراً – 11:00 مساءً'))
  || jsonb_build_object('categories', (
       select coalesce(jsonb_agg(c || jsonb_build_object(
                'ar', coalesce(nullif(c->>'ar', ''), m.v->>'ar', ''),
                'subs_ar', coalesce(m.v->'subs', '{}'::jsonb) || coalesce(c->'subs_ar', '{}'::jsonb)) order by ord), '[]'::jsonb)
       from jsonb_array_elements(coalesce(s.data->'categories', '[]'::jsonb)) with ordinality as e(c, ord)
       left join jsonb_each('{"Jewelry":{"ar":"مجوهرات","subs":{"Necklaces":"قلادات","Bracelets":"أساور","Bangles":"إسورة","Rings":"خواتم","Earrings":"حلقان","Earring Sets":"أطقم حلق","Anklets":"خلاخيل","Sets":"أطقم"}},"Bags":{"ar":"شنط","subs":{"Shoulder Bags":"شنط كتف","Cross Bags":"شنط كروس","Clutches":"كلاتش","Wallets":"محافظ","Others":"أخرى"}},"Sunglasses":{"ar":"نظارات شمس","subs":{}},"Watches":{"ar":"ساعات","subs":{}}}'::jsonb) m(k, v) on m.k = c->>'name'))
  || jsonb_build_object('delivery', (
       select coalesce(jsonb_agg(d || jsonb_build_object('ar', coalesce(nullif(d->>'ar', ''), '{"Cairo":"القاهرة","Giza":"الجيزة","Alexandria":"الإسكندرية","Other governorates":"محافظات أخرى"}'::jsonb->>(d->>'city'), '')) order by ord), '[]'::jsonb)
       from jsonb_array_elements(coalesce(s.data->'delivery', '[]'::jsonb)) with ordinality as e(d, ord)))
where s.id = 1;
