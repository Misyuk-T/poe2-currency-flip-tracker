# UX-аудит PoE2 Flip Tracker

Дата: 21 червня 2026

## Короткий висновок

Продукт уже вміє показувати каталог, погодинну історію, графіки, книги обміну, золото й ручну актуальну ціну. Але як користувач я поки бачу радше аналітичний термінал, ніж відповідь на просте питання:

> Що мені купити зараз, за скільки виставити й наскільки реально, що угода закриється за мій час?

Основна проблема — не кількість функцій, а відсутність чіткої ієрархії між ними. Для однієї валюти одночасно існують:

- погодинний midpoint;
- введена користувачем актуальна ціна;
- entry/exit із live book;
- історичний діапазон;
- Activity і Arbitrage scores.

Інтерфейс показує ці значення на різних екранах, але не пояснює, яке з них є робочою ціною для рішення. Через це цифри виглядають суперечливими, навіть коли кожна з них технічно коректна у своєму контексті.

## Ким я себе уявляю

Я граю в PoE 2, маю обмежений запас Exalted/Divine і золота. Я не хочу весь вечір дивитися на графіки. Мої типові сценарії:

1. Знайти 3–5 адекватних ринків, а не переглядати сотні айтемів.
2. Зрозуміти, чи ціна зараз низька, нормальна або вже запізно купувати.
3. Вказати ціну, яку реально бачу в грі.
4. Отримати рекомендований вхід і вихід під горизонт 1–3 години або 5–10 годин.
5. Побачити шанс досягнення ціни та приблизний час виконання.
6. Не витратити весь запас золота на один обмін.
7. Залишити ордер на ніч і не ставити нереалістичну націнку.

## Що вже добре

- Категорії та іконки значно полегшують навігацію.
- Сортування за ціною всередині категорії відповідає звичному патерну PoE2Scout.
- Автоматичне відображення ціни в Exalted або Divine читається природно.
- Є явне маркування fixture/stale, тобто продукт не приховує походження даних.
- Ручна ціна `Price now` вирішує проблему запізнілого погодинного midpoint.
- Технічні деталі opportunity заховані в `<details>`, а не вивалені одразу.
- Gold budget і reserve вже присутні в моделі.

## Де я напружуюсь

### P0. Немає однієї відповіді «що робити»

На Market Radar я бачу рух, обсяг, Activity та Arbitrage. У Live books — entry, exit, quantity, profit, ROI, gold і limiting resource. У модалці історії — ще одна пара рекомендованих entry/exit від ручної ціни.

Я не розумію:

- рекомендація `237 → 243` важливіша чи слабша за book `204 → 212`;
- чи ручні `240 Exalted` вплинули на Live books;
- чи можу я виконати угоду зараз;
- який із двох екранів є основним.

Потрібне єдине поняття **Working price** із чітким пріоритетом джерел:

1. актуальний executable live book;
2. ручна ціна користувача;
3. останній погодинний midpoint.

Біля ціни завжди мають бути source і age: `Live book · 26s`, `You entered · now`, `Hourly · 1h 12m`.

### P0. Market Radar ранжує шум вище корисних ринків

На `All markets` за замовчуванням стоїть Activity. Першими з'являються дешеві й випадкові айтеми на кшталт `0.007 Exalted`, часто зі stale history та статусом `Hourly only`. Як користувач я одразу думаю, що рейтинг неадекватний.

`748 active` також конфліктує з тим, що більшість рядків позначені stale або не мають live book. Слово `active` тут звучить як «можна торгувати зараз», хоча фактично означає лише наявність історичної свічки.

Головний список має за замовчуванням показувати не весь каталог, а shortlist:

- є свіжа або введена користувачем ціна;
- достатня ліквідність;
- є реалістичний план входу/виходу;
- прибуток перевищує мінімум;
- враховано gold budget;
- є достатня історична вибірка для обраного горизонту.

Весь каталог варто залишити як окремий режим `Browse all markets`.

### P0. Ручна ціна та Live books живуть окремо

Я ввів для Divine Orb `240 Exalted` і отримав історичний план приблизно `237 → 243`. Після переходу в Live books бачу `204 → 212`. Інтерфейс не говорить, що це різні моделі, і ручна ціна не переноситься в opportunity decision.

Це найбільший удар по довірі. Потрібно або:

- використовувати ручну ціну як current market context у єдиному калькуляторі;
- або прямо показувати конфлікт: `Your observed price is 13.2% above this book snapshot — book may be stale or non-executable`.

Мовчки показувати дві різні рекомендації не можна.

### P0. Немає режиму під час утримання

Для сценарію «залишити на ніч» недостатньо поточного median hourly range. Необхідні:

- горизонт: 1h, 3h, 6h, 8h, 10h, 24h;
- мінімальний бажаний чистий прибуток;
- confidence/hit rate;
- median time to hit;
- шанс, що ціна спочатку піде проти позиції;
- результат після gold cost.

Не можна просто множити погодинну волатильність на кількість годин. Треба будувати rolling historical windows і перевіряти, чи досягав майбутній high/low потрібного бар'єра всередині кожного горизонту.

## Де забагато цифр

### Головна таблиця

Одночасно показані Now, 1h, 6h, 24h, Range, Volume, volume change, Activity та Arbitrage. Для первинного рішення це забагато.

У списку достатньо п'яти речей:

1. Item.
2. Working price + source age.
3. 24h direction/sparkline.
4. Liquidity або market quality одним зрозумілим індикатором.
5. `Trade fit`: `Good for 8h`, `Too volatile`, `Low liquidity`, `No current price`.

1h/6h/volume/score/range слід перенести в detail або в налаштовувані колонки.

### Activity і Arbitrage

Числа `32`, `84.7`, `72.8` нічого не означають без шкали та наслідку. Навіть tooltip із формулою не відповість на питання «добре це чи погано для мене?».

Краще показати людські категорії:

- `Fast-moving`;
- `Stable`;
- `Thin market`;
- `High volatility`;
- `Insufficient data`.

Сирий score можна залишити в technical details.

### Live books

Entry, Exit, Qty, Profit, ROI, Gold, Profit/100k і Limited by — корисні для перевірки, але не всі однаково важливі.

Основний рядок має показувати:

- `Buy ≤`;
- `Sell ≥`;
- `Net profit`;
- `Chance within horizon`;
- `Gold required`.

ROI, profit/100k, depth і limiting resource — другий рівень.

## Що неочевидно

### `Market Radar` проти `Live books`

Назви звучать як два джерела даних, а не два користувацькі завдання. У fixture mode `Live books` узагалі не є live, що ще більше плутає.

Зрозуміліша структура:

- `Discover` — знайти ринок;
- `Plan trade` — розрахувати конкретну угоду;
- `Watchlist` — повернутися до вибраних;
- `Journal` — перевірити, чи рекомендації реально працювали.

### `Analyze flip` і клік по рядку

Клік по рядку відкриває hourly history. `Analyze flip` перекидає в Live books і відкриває іншу модалку. Дві дії поруч мають різну семантику, але це не пояснено.

Краще мати один primary action `Plan trade`. Графік відкривається як secondary action або вкладка всередині detail.

### `Anchor`

Для технічної моделі anchor зрозумілий, для звичайного гравця — ні. Користувач думає «я торгую за Exalted» або «я торгую за Divine».

Назва поля має бути `I trade with`, а в budget — `Available Exalted` або `Available Divine`, не `Capital (anchor)`.

### Gold mode

`Strict budget`, `Show only`, `Ignore` вимагають знання внутрішньої логіки. Потрібні короткі пояснення прямо в select або поруч:

- `Limit trades by my gold`;
- `Calculate gold, don't limit`;
- `Don't use gold in recommendations`.

### Stale проти fresh

У detail одночасно видно `Stale hourly history` і `Book freshness 26s ago`. Це може бути абсолютно правильно, але без двох окремих підписів здається багом.

Треба розділити:

- `Current quote freshness`;
- `Historical model freshness`.

## Проблеми графіка

- Графік не має перемикача 6h/24h/7d.
- Немає hover/crosshair із часом, ціною та volume.
- Немає ліній manual current price, recommended entry та exit.
- Конвертована headline price може бути в Divine, тоді як вісь high/low лишається у сирих Exalted. Наприклад, зверху `2.76 Divine`, а вісь показує `high 689 / low 642` без одиниці. Це виглядає як арифметична помилка.
- У Chart view список із 30 ринків забирає увагу в самого графіка.
- На mobile горизонтальний список ринків розташований перед графіком; графік починається приблизно нижче 1100 px сторінки.
- Пояснення `This is not an OHLC candlestick chart` технічно чесне, але користувачу важливіше знати, що саме він може з цього графіка вирішити.

Графік має бути частиною decision detail, а не окремим режимом заради режиму.

## Mobile-аудит

Mobile зараз формально responsive, але не task-first.

У Live books до першої opportunity треба пройти:

- глобальні game/league/anchor;
- capital/gold/reserve;
- horizon/gold mode/rank;
- workspace navigation;
- filters.

Під час перевірки основний books content починався приблизно на 821 px, тобто майже після цілого першого екрана. У Market Radar controls займали приблизно 576 px, а графік починався нижче 1100 px.

Модалка Divine Orb на viewport `390×844` мала близько `1593 px` внутрішнього контенту. Блок `Price now`, заради якого користувач відкрив модалку, починався після графіка приблизно на 653 px, а Current signal був уже нижче 1300 px.

Що змінити:

- глобальні налаштування сховати в compact top sheet;
- sidebar на mobile замінити двома горизонтальними рівнями: workspace tabs і category chips;
- показувати results одразу в першому viewport;
- `Price now` та trade plan поставити перед графіком;
- графік зробити collapsed за замовчуванням;
- фільтри відкрити через одну кнопку `Filters (2)`;
- primary action закріпити внизу detail.

## Чого не вистачає

### Для рішення

- Working price з джерелом і timestamp.
- Horizon 8h/10h/24h.
- Мінімальний net profit у Exalted/Divine або %.
- Historical hit rate для entry та exit.
- Median time to hit.
- Maximum adverse excursion: наскільки ціна історично йшла проти позиції.
- Розмір позиції після capital, liquidity та gold constraints.
- Явний verdict: `Trade`, `Wait for entry`, `Skip`, `Insufficient data`.

### Для довіри

- Кількість історичних вікон, на яких побудовано рекомендацію.
- Розділення fixture/demo та реальних даних не лише badge, а й візуальним режимом.
- Попередження про конфлікт manual price і live book.
- Виявлення аномальних ринків і відсікання очевидного synthetic/noise з default ranking.
- Єдина одиниця на headline, графіку та рекомендаціях.

### Для повернення користувача

- Watchlist/favorites.
- Збережені trade plans.
- Paper-trade journal: що радили, чи був досягнутий entry/exit, скільки часу це зайняло.
- Alerts: `entry reached`, `exit reached`, `price moved against plan`.
- Нічний preset, наприклад `Conservative · 8h`.

Автоматичне виставлення ордерів у грі для цього продукту не потрібне.

## Запропонована інформаційна архітектура

### 1. Discover

Головний екран відповідає лише на питання «що варто відкрити?».

Картка/рядок:

- Item + icon;
- working price + source age;
- 24h sparkline;
- liquidity label;
- verdict під вибраний preset;
- кнопка `Plan trade`.

Default view — `Tradable now`, а не всі 748 айтемів.

### 2. Plan trade

Верх detail має вміщатися в один desktop viewport і приблизно 1–1.5 mobile viewport:

1. Working price: `240 Ex · You entered now`.
2. Horizon: `8h`.
3. Minimum net profit: `3 Ex`.
4. Gold budget toggle.
5. Verdict: `Wait for entry`.
6. `Buy ≤ 237 Ex`.
7. `Sell ≥ 243 Ex`.
8. `Historical hit rate 74% · median 5.6h`.
9. `Gold 104k · position 4 Divine · net +12 Ex`.

Нижче:

- chart;
- current book depth;
- historical metrics;
- formulas/technical details.

### 3. Watchlist

Тільки вибрані ринки з поточним status щодо плану:

- waiting for entry;
- bought / waiting for exit;
- target reached;
- invalidated;
- stale data.

### 4. Journal

Без journal ми не зможемо довести користувачу, що рекомендації мають практичну цінність, і не зможемо нормально калібрувати confidence.

## Як рахувати overnight-рекомендацію

Для кожного історичного стартового часу `t`:

1. Беремо reference price у `t`.
2. Дивимося всі high/low у наступні `H` годин.
3. Рахуємо maximum favorable excursion і maximum adverse excursion.
4. Перевіряємо, чи було досягнуто candidate exit до завершення горизонту.
5. Записуємо time-to-hit.

Після цього:

- conservative target — рівень, якого досягали, наприклад, у 70% валідних вікон;
- hit rate — фактична частка вікон, а не score;
- median time — медіана лише серед успішних вікон;
- рекомендація приховується, якщо sample size або coverage недостатні;
- gold і position sizing застосовуються після вибору price barriers.

Це descriptive backtest, не гарантія і не прогноз. Саме так його й треба називати.

## Пріоритет реалізації

### P0 — до публічного Reddit-посту

1. Об'єднати manual price, hourly price і live book у Working price model.
2. Прибрати суперечливі рекомендації між Radar і Live books.
3. Зробити default shortlist `Tradable now`.
4. Додати horizon-aware hit rate/time-to-hit для 1–10h.
5. Перебудувати detail навколо verdict + buy/sell, а не графіка.
6. Виправити одиниці графіка.
7. Не називати fixture books live.

### P1 — одразу після

1. Watchlist і saved plans.
2. Mobile filters sheet та компактні global settings.
3. Presets: `Quick flip`, `Evening`, `Overnight`.
4. Paper-trade journal.
5. Людські market labels замість сирих scores.

### P2 — після появи реальних користувачів

1. Alerts.
2. Налаштовувані колонки.
3. Розширений графік із crosshair/timeframes.
4. Персональні presets і risk tolerance.

## Критерії готовності нового UX

- Новий користувач за 30 секунд знаходить одну валюту й може пояснити, чому вона рекомендована.
- Для кожного price/entry/exit видно source, unit і freshness.
- На одному екрані немає двох рекомендацій без явного пояснення різниці.
- Overnight plan показує horizon, hit rate, sample size і median time-to-hit.
- Перший корисний result видно без вертикального scroll на типовому mobile viewport.
- Основний detail містить не більше 5 ключових чисел до розкриття advanced details.
- Fixture mode неможливо сприйняти як live market.
- Якщо manual price сильно відрізняється від book/hourly data, користувач бачить conflict warning.

## Найважливіше продуктове рішення

Не треба робити ще один PoE2Scout із більшою кількістю колонок. Цінність цього продукту — перетворити ринкові дані на конкретний, обмежений у часі й золоті trade plan:

> За цієї актуальної ціни, мого бюджету та горизонту — чекати, купувати чи пропустити?

Усе, що не допомагає відповісти на це питання, має бути другим рівнем інтерфейсу.
