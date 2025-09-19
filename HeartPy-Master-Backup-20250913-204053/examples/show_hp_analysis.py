import inspect
import heartpy.analysis as an
print(an.__file__)
print('--- functions ---')
print([name for name,obj in an.__dict__.items() if callable(obj) and 'sdnn' in name or 'rmssd' in name])
print('--- calc_sdnn ---')
print(inspect.getsource(an.calc_sdnn))
print('--- calc_rmssd ---')
print(inspect.getsource(an.calc_rmssd))
