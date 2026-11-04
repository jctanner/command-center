class Credentials:
 expired=False
 valid=True
 @classmethod
 def from_authorized_user_file(cls,path): return cls()
