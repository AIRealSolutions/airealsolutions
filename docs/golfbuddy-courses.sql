-- Golf Buddy courses. Safe to re-run: a course is only added if its name is new.
-- Carolina National Golf Club, Bolivia NC: three nines (Egret, Heron, Ibis) played as 18-hole combos.
-- Transcribed from the club scorecard; every yardage row matches the card's OUT total.
-- 18-hole handicap: front nine uses the card's men's handicap h -> 2h-1, back nine -> 2h.
-- course_rating / slope_rating are the men's Blue tee values for the combo.

with nines(nine, hole, par, hcp, black, blue, white) as (values
  ('egret',1,4,4,388,350,276),('egret',2,4,2,427,357,300),('egret',3,5,6,577,506,421),
  ('egret',4,4,7,384,340,257),('egret',5,3,8,184,138,110),('egret',6,4,1,445,369,279),
  ('egret',7,3,5,219,181,139),('egret',8,4,3,390,316,271),('egret',9,5,9,486,427,347),
  ('heron',1,4,3,400,361,318),('heron',2,5,9,530,458,393),('heron',3,4,6,384,312,201),
  ('heron',4,4,7,365,312,243),('heron',5,3,4,203,182,121),('heron',6,4,1,432,350,247),
  ('heron',7,4,2,443,374,267),('heron',8,3,8,173,141,105),('heron',9,5,5,587,508,443),
  ('ibis',1,5,9,552,472,408),('ibis',2,4,4,339,325,250),('ibis',3,4,1,420,345,314),
  ('ibis',4,4,2,417,334,248),('ibis',5,3,8,167,138,106),('ibis',6,4,6,431,335,283),
  ('ibis',7,5,7,530,474,356),('ibis',8,3,5,194,166,124),('ibis',9,4,3,394,352,239)
),
combos(name, front, back, rating, slope) as (values
  ('Carolina National · Egret/Heron', 'egret', 'heron', 69.4, 133),
  ('Carolina National · Heron/Ibis',  'heron', 'ibis',  69.9, 128),
  ('Carolina National · Ibis/Egret',  'ibis',  'egret', 69.5, 128)
),
new_courses as (
  insert into golfbuddy.courses (name, location, city, state, country, par, course_rating, slope_rating)
  select c.name, 'Carolina National Golf Club', 'Bolivia', 'NC', 'USA', 72, c.rating, c.slope
  from combos c
  where not exists (select 1 from golfbuddy.courses x where x.name = c.name)
  returning id, name
)
insert into golfbuddy.holes (course_id, hole_number, par, handicap, length, yards_black, yards_blue, yards_white)
select nc.id,
       n.hole + case when n.nine = c.back then 9 else 0 end,
       n.par,
       case when n.nine = c.front then 2 * n.hcp - 1 else 2 * n.hcp end,
       n.blue, n.black, n.blue, n.white
from new_courses nc
join combos c on c.name = nc.name
join nines n on n.nine in (c.front, c.back);
