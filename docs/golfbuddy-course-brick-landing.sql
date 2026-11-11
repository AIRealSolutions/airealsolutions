-- Golf Buddy course: Brick Landing Plantation, Ocean Isle Beach NC (18 holes, par 71).
-- Safe to re-run: the course is only added if its name is new.
-- Blue tee yardages (6155 total: 2737 out / 3418 in), pars and men's handicaps from published scorecards
-- (BlueGolf / GolfPass). Rating / slope are the men's Blue tee values (71.2 / 136).
-- Per-hole White (5624), Gold (4817) and Red (4335) yardages weren't available, so only Blue is filled in;
-- add yards_white later from the club card if you want it.

with card(hole, par, hcp, blue) as (values
  (1,4,5,347),(2,3,17,92),(3,4,7,347),(4,4,11,316),(5,3,13,146),(6,4,3,402),(7,4,15,357),(8,5,1,551),(9,3,9,179),
  (10,4,2,460),(11,4,14,349),(12,4,6,344),(13,3,18,162),(14,5,12,512),(15,4,16,333),(16,5,10,478),(17,4,4,428),(18,4,8,352)
),
new_course as (
  insert into golfbuddy.courses (name, location, city, state, country, par, course_rating, slope_rating)
  select 'Brick Landing Plantation', 'Brick Landing Plantation Yacht & Golf Club', 'Ocean Isle Beach', 'NC', 'USA', 71, 71.2, 136
  where not exists (select 1 from golfbuddy.courses x where x.name = 'Brick Landing Plantation')
  returning id
)
insert into golfbuddy.holes (course_id, hole_number, par, handicap, length, yards_blue)
select nc.id, c.hole, c.par, c.hcp, c.blue, c.blue
from new_course nc cross join card c;
